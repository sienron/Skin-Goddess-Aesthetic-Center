// routes/auth.js
// Contains all the logic for Register, Verify OTP, Resend OTP,
// Login, Forgot Password, Reset Password, and Logout. Each
// "router.post(...)" below is like a separate "door" with its own job.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
// bcryptjs is used to hash passwords before saving them.
// crypto (built into Node) is used to generate random reset tokens
// for the forgot password feature.

const router = express.Router();
// The Router is like a mini-server focused on one specific
// group of routes (here, everything related to "auth").

const db = require('../db'); // used to query the database
const { sendOtpEmail, sendPasswordResetEmail } = require('../utils/mailer'); // for sending actual emails
const isValidPassword = require('../utils/password');

function generateOtpCode() {
  // Generates a random 6-digit number, e.g. "042917"
  const randomNumber = Math.floor(100000 + Math.random() * 900000);
  return String(randomNumber);
}

// ============================================
// ROUTE 1: REGISTER (Create a new account)
// ============================================
router.post('/register', async (req, res) => {
  const {
    firstName,
    lastName,
    dob,
    gender,
    civilStatus,
    contactNumber,
    address,
    allergies,
    conditions,
    email,
    password,
  } = req.body;

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!firstName || !lastName || !normalizedEmail || !password) {
    return res.status(400).json({ message: 'Fill out all the fields' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters, contain both letters and numbers, and must not include special characters.',
    });
  }

  let newUser = null;

  try {
    const existingUser = await db.query(
      'SELECT user_id, email_verified FROM users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      const foundUser = existingUser.rows[0];

      if (foundUser.email_verified) {
        // Real, completed account already exists — block as before
        return res.status(409).json({ message: 'This email has already been used.' });
      }

      // Account exists but was never verified — send a fresh code
      // instead of dead-ending the user here
      const freshOtpCode = generateOtpCode();
      await db.query(
        `INSERT INTO otp_codes (user_id, code, purpose, expires_at)
         VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '5 minutes')`,
        [foundUser.user_id, freshOtpCode]
      );

      try {
        await sendOtpEmail(normalizedEmail, freshOtpCode);
      } catch (emailError) {
        console.log('Resend OTP email failed:', emailError);
        return res.status(502).json({
          message: 'Account exists but we could not send the verification email. Please try again in a bit.',
        });
      }

      return res.status(200).json({
        message: 'Account already exists but is not verified. A new code has been sent.',
        userId: foundUser.user_id,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertResult = await db.query(
      `INSERT INTO users
        (email, password_hash, first_name, last_name, date_of_birth, gender,
         civil_status, contact_number, home_address, allergies, medical_conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING user_id, email`,
      [
        normalizedEmail,
        hashedPassword,
        firstName,
        lastName,
        dob || null,
        gender || null,
        civilStatus || null,
        contactNumber || null,
        address || null,
        allergies || null,
        conditions || null,
      ]
    );

    newUser = insertResult.rows[0];

    const otpCode = generateOtpCode();
    await db.query(
      `INSERT INTO otp_codes (user_id, code, purpose, expires_at)
       VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '5 minutes')`,
      [newUser.user_id, otpCode]
    );

    try {
      await sendOtpEmail(newUser.email, otpCode);
    } catch (emailError) {
      console.log('Registration OTP email failed:', emailError);
      // Rollback the half-finished account so the email becomes
      // available again for retry
      await db.query('DELETE FROM users WHERE user_id = $1', [newUser.user_id]);
      return res.status(502).json({
        message: 'Account could not be created because the verification email failed to send. Please try again.',
      });
    }

    res.status(201).json({
      message: 'Account created. Check email for verification code.',
      userId: newUser.user_id,
    });
  } catch (error) {
    console.log('Registration error:', error);
    res.status(500).json({ message: 'Error. Try Again.' });
  }
});

// ============================================
// ROUTE 2: VERIFY OTP (Verify the 6-digit code)
// ============================================
router.post('/verify-otp', async (req, res) => {
  const { userId, code } = req.body;

  if (!userId || !code) {
    return res.status(400).json({ message: 'Enter six digit code.' });
  }

  try {
    // Note: expiration is checked directly in SQL (expires_at > NOW())
    // instead of comparing dates in JavaScript, to avoid timezone
    // mismatch issues between the server and the database.
    const otpResult = await db.query(
      `SELECT otp_id, code
       FROM otp_codes
       WHERE user_id = $1
         AND purpose = 'email_verification'
         AND is_used = FALSE
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ message: 'Code expired or not found. Resend code.' });
    }

    const otpRow = otpResult.rows[0];

    if (otpRow.code !== code) {
      return res.status(400).json({ message: 'Wrong code. Try again.' });
    }

    await db.query('UPDATE otp_codes SET is_used = TRUE WHERE otp_id = $1', [otpRow.otp_id]);

    await db.query('UPDATE users SET email_verified = TRUE WHERE user_id = $1', [userId]);

    res.status(200).json({ message: 'Successful email verification.' });
  } catch (error) {
    console.log('OTP verification error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 3: RESEND OTP (Send a new code)
// ============================================
router.post('/resend-otp', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ message: 'Incomplete code' });
  }

  try {
    const userResult = await db.query('SELECT email FROM users WHERE user_id = $1', [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    const userEmail = userResult.rows[0].email;

    const newOtpCode = generateOtpCode();
    await db.query(
      `INSERT INTO otp_codes (user_id, code, purpose, expires_at)
       VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '5 minutes')`,
      [userId, newOtpCode]
    );

    await sendOtpEmail(userEmail, newOtpCode);

    res.status(200).json({ message: 'Code has been sent.' });
  } catch (error) {
    console.log('Error while resending OTP code:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 4: LOGIN
// ============================================
router.post('/login', async (req, res) => {
  const { email, password, staysignedin } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: 'Email and password required.' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Incorrect email or password.' });
    }

    const user = result.rows[0];

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Incorrect email or password.' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ message: 'Verify email to login.' });
    }

    const dashboardPerRole = {
      client: '/index.html',
      admin: '/AdminDashboard.html',
      aesthetician: '/AestheticianDashboard.html',
      inventory_officer: '/InventoryDashboard.html',
      finance_officer: '/FinanceDashboard.html',
      staff: '/StaffDashboard.html',
    };

    req.session.userId = user.user_id;
    req.session.role = user.role;

    // "Stay Signed In" checked -> keep the cookie for 30 days.
    // Unchecked -> fall back to the default 24-hour cookie set in index.js.
    if (staysignedin) {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
    }

    res.status(200).json({
      message: 'Successful login.',
      userId: user.user_id,
      role: user.role,
      redirectUrl: dashboardPerRole[user.role] || '/dashboard',
    });
  } catch (error) {
    console.log('Login error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE: GET CURRENT USER (for displaying name/initials in the header)
// ============================================
router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  try {
    const result = await db.query(
      'SELECT first_name, last_name, email, contact_number, role FROM users WHERE user_id = $1',
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    const user = result.rows[0];
    res.status(200).json({
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      contactNumber: user.contact_number,
      role: user.role,
    });
  } catch (error) {
    console.log('Get current user error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE: GET PROFILE (editable fields, for account page)
// ============================================
router.get('/profile', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  try {
    const result = await db.query(
      `SELECT first_name, last_name, email, contact_number
       FROM users WHERE user_id = $1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    const user = result.rows[0];
    res.status(200).json({
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      contactNumber: user.contact_number,
    });
  } catch (error) {
    console.log('Get profile error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE: UPDATE PROFILE (name, email, contact number)
// ============================================
router.put('/update-profile', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  const { firstName, lastName, email, contactNumber } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!firstName || !lastName || !normalizedEmail) {
    return res.status(400).json({ message: 'Name and email are required.' });
  }

  try {
    // Make sure no OTHER account already uses this email
    const existing = await db.query(
      'SELECT user_id FROM users WHERE LOWER(email) = $1 AND user_id != $2',
      [normalizedEmail, req.session.userId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'This email is already in use by another account.' });
    }

    await db.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, email = $3, contact_number = $4
       WHERE user_id = $5`,
      [firstName, lastName, normalizedEmail, contactNumber || null, req.session.userId]
    );

    res.status(200).json({ message: 'Profile updated successfully.' });
  } catch (error) {
    console.log('Update profile error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE: CHANGE PASSWORD (requires current password)
// ============================================
router.put('/change-password', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required.' });
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters, contain both letters and numbers, and must not include special characters.',
    });
  }

  try {
    const result = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [req.session.userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    const currentHash = result.rows[0].password_hash;

    const isCurrentCorrect = await bcrypt.compare(currentPassword, currentHash);
    if (!isCurrentCorrect) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    const isSameAsOld = await bcrypt.compare(newPassword, currentHash);
    if (isSameAsOld) {
      return res.status(400).json({ message: 'New password cannot be the same as your current password.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [newHash, req.session.userId]);

    res.status(200).json({ message: 'Password changed successfully.' });
  } catch (error) {
    console.log('Change password error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 5: FORGOT PASSWORD (Send reset link)
// ============================================
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail) {
    return res.status(400).json({ message: 'Email address is required.' });
  }

  try {
    const userResult = await db.query('SELECT user_id, email FROM users WHERE LOWER(email) = $1', [normalizedEmail]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Account does not exist.' });
    }

    const user = userResult.rows[0];

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [user.user_id, tokenHash]
    );

    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://skin-goddess-aesthetic-center-sf0r.onrender.com'
      : 'http://localhost:3000';
    const resetLink = `${baseUrl}/ResetPassword.html?token=${rawToken}`;
    await sendPasswordResetEmail(user.email, resetLink);

    res.status(200).json({ message: 'Reset link has been sent.' });
  } catch (error) {
    console.log('Forgot password error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 6: RESET PASSWORD (Set a new password)
// ============================================
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ message: 'Token and new password are required.' });
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters, contain both letters and numbers, and must not include special characters.',
    });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Same fix here — check expiration directly in SQL
    const tokenResult = await db.query(
      `SELECT reset_id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND is_used = FALSE
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired reset link.' });
    }

    const tokenRow = tokenResult.rows[0];

    // Fetch the user's current password hash so we can check
    // whether the new password is the same as the old one
    const userResult = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [
      tokenRow.user_id,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    const currentPasswordHash = userResult.rows[0].password_hash;

    const isSameAsOldPassword = await bcrypt.compare(newPassword, currentPasswordHash);
    if (isSameAsOldPassword) {
      return res.status(400).json({
        message: 'New password cannot be the same as your old password. Please choose a different one.',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [
      hashedPassword,
      tokenRow.user_id,
    ]);

    await db.query('UPDATE password_reset_tokens SET is_used = TRUE WHERE reset_id = $1', [
      tokenRow.reset_id,
    ]);

    res.status(200).json({ message: 'Password has been reset successfully.' });
  } catch (error) {
    console.log('Reset password error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 7: LOGOUT
// ============================================
router.post('/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.log('Logout error:', error);
      return res.status(500).json({ message: 'Error logging out.' });
    }
    res.status(200).json({ message: 'Logged out successfully.' });
  });
});

module.exports = router;
// Exported to index.js, used with:
// app.use('/api/auth', require('./routes/auth'))