// routes/auth.js
// Contains all the logic for Register, Verify OTP, Resend OTP,
// Login, Forgot Password, Reset Password, and Logout. Each
// "router.post(...)" below is like a separate "door" with its own job.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
// bcryptjs is used to hash passwords before saving them.
// crypto (built into Node) is used to generate random reset tokens
// for the forgot password feature.

const router = express.Router();
// The Router is like a mini-server focused on one specific
// group of routes (here, everything related to "auth").

const db = require('../db'); // used to query the database
const { sendOtpEmail, sendPasswordResetEmail } = require('../utils/mailer'); // for sending actual emails
const isValidPassword = require('../utils/password');

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, message: { message: 'Too many registration attempts. Try again later.' } });
const verifyOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many verification attempts. Try again later.' } });
const resendOtpLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, message: { message: 'Too many code requests. Try again later.' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many sign-in attempts. Try again later.' } });
const forgotPasswordLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, message: { message: 'Too many reset requests. Try again later.' } });
const emailChangeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, message: { message: 'Too many code requests. Try again later.' } });
const verifyEmailChangeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many verification attempts. Try again later.' } });

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

async function recentVerificationCodeCount(userId) {
  const result = await db.query(`
    SELECT COUNT(*)::integer AS count
    FROM otp_codes
    WHERE user_id = $1 AND purpose = 'email_verification'
      AND created_at > NOW() - INTERVAL '1 hour'
  `, [userId]);
  return result.rows[0].count;
}

async function recentEmailChangeCodeCount(userId) {
  const result = await db.query(`
    SELECT COUNT(*)::integer AS count
    FROM pending_email_changes
    WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
  `, [userId]);
  return result.rows[0].count;
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

// ============================================
// ROUTE 1: REGISTER (Create a new account)
// ============================================
router.post('/register', registerLimiter, async (req, res) => {
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
      message: 'Password must be between 8 and 72 characters.',
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
      if (await recentVerificationCodeCount(foundUser.user_id) >= 5) {
        return res.status(429).json({ message: 'Too many code requests. Try again later.' });
      }
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

      await regenerateSession(req);
      req.session.pendingVerificationUserId = foundUser.user_id;

      return res.status(200).json({
        message: 'Account already exists but is not verified. A new code has been sent.',
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

    await regenerateSession(req);
    req.session.pendingVerificationUserId = newUser.user_id;

    res.status(201).json({
      message: 'Account created. Check email for verification code.',
    });
  } catch (error) {
    console.log('Registration error:', error);
    res.status(500).json({ message: 'Error. Try Again.' });
  }
});

// ============================================
// ROUTE 2: VERIFY OTP (Verify the 6-digit code)
// ============================================
router.post('/verify-otp', verifyOtpLimiter, async (req, res) => {
  const userId = req.session.pendingVerificationUserId;
  const code = typeof req.body.code === 'string' ? req.body.code : '';

  if (!userId || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: 'Enter six digit code.' });
  }

  try {
    const outcome = await db.transaction(async (client) => {
      const otpResult = await client.query(`
        SELECT otp_id, code, attempts
        FROM otp_codes
        WHERE user_id = $1 AND purpose = 'email_verification'
          AND is_used = FALSE AND expires_at > NOW() AND attempts < 5
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [userId]);
      if (otpResult.rows.length === 0) return 'invalid';

      const otp = otpResult.rows[0];
      if (otp.code !== code) {
        await client.query(`
          UPDATE otp_codes
          SET attempts = attempts + 1,
              is_used = (attempts + 1 >= 5)
          WHERE otp_id = $1
        `, [otp.otp_id]);
        return 'invalid';
      }

      await client.query('UPDATE otp_codes SET is_used = TRUE WHERE otp_id = $1', [otp.otp_id]);
      await client.query('UPDATE users SET email_verified = TRUE WHERE user_id = $1', [userId]);
      return 'verified';
    });

    if (outcome !== 'verified') {
      return res.status(400).json({ message: 'Invalid, expired, or locked verification code.' });
    }

    delete req.session.pendingVerificationUserId;
    return res.status(200).json({ message: 'Successful email verification.' });
  } catch (error) {
    console.log('OTP verification error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 3: RESEND OTP (Send a new code)
// ============================================
router.post('/resend-otp', resendOtpLimiter, async (req, res) => {
  const userId = req.session.pendingVerificationUserId;

  if (!userId) {
    return res.status(401).json({ message: 'Registration verification session expired. Register again to continue.' });
  }

  try {
    const userResult = await db.query('SELECT email, email_verified FROM users WHERE user_id = $1', [userId]);

    if (userResult.rows.length === 0) {
      delete req.session.pendingVerificationUserId;
      return res.status(401).json({ message: 'Registration verification session is no longer valid.' });
    }
    if (userResult.rows[0].email_verified) {
      delete req.session.pendingVerificationUserId;
      return res.status(400).json({ message: 'This email is already verified.' });
    }
    if (await recentVerificationCodeCount(userId) >= 5) {
      return res.status(429).json({ message: 'Too many code requests. Try again later.' });
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
router.post('/login', loginLimiter, async (req, res) => {
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

    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Your account is suspended.' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ message: 'Verify email to login.' });
    }

    const dashboardPerRole = {
      client: '/index.html',
      admin: '/AdminDashboard.html',
      aesthetician: '/StaffDashboard.html',
      nail_tech: '/StaffDashboard.html',
      inventory_officer: '/InventoryDashboard.html',
      finance_officer: '/FinanceDashboard.html',
      staff: '/StaffDashboard.html',
    };

    await regenerateSession(req);
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
// ROUTE: UPDATE PROFILE (name, contact number only — email has its own flow)
// ============================================
router.put('/update-profile', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  const { firstName, lastName, contactNumber } = req.body;

  if (!firstName || !lastName) {
    return res.status(400).json({ message: 'First and last name are required.' });
  }

  try {
    await db.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, contact_number = $3
       WHERE user_id = $4`,
      [firstName, lastName, contactNumber || null, req.session.userId]
    );

    res.status(200).json({ message: 'Profile updated successfully.' });
  } catch (error) {
    console.log('Update profile error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE: REQUEST EMAIL CHANGE (sends a code to the NEW email)
// ============================================
router.post('/request-email-change', emailChangeLimiter, async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  const { newEmail } = req.body;
  const normalizedEmail = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : '';

  if (!normalizedEmail) {
    return res.status(400).json({ message: 'A new email address is required.' });
  }

  try {
    const currentUser = await db.query('SELECT email FROM users WHERE user_id = $1', [req.session.userId]);
    if (currentUser.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    if (currentUser.rows[0].email.toLowerCase() === normalizedEmail) {
      return res.status(400).json({ message: 'That is already your current email address.' });
    }

    const existing = await db.query(
      'SELECT user_id FROM users WHERE LOWER(email) = $1 AND user_id != $2',
      [normalizedEmail, req.session.userId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'This email is already in use by another account.' });
    }

    if (await recentEmailChangeCodeCount(req.session.userId) >= 3) {
      return res.status(429).json({ message: 'Too many code requests. Try again later.' });
    }

    const code = generateOtpCode();
    await db.query(
      `INSERT INTO pending_email_changes (user_id, new_email, code, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
      [req.session.userId, normalizedEmail, code]
    );

    await sendOtpEmail(normalizedEmail, code);

    res.status(200).json({ message: 'A verification code has been sent to your new email address.' });
  } catch (error) {
    console.log('Request email change error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE: CONFIRM EMAIL CHANGE (verifies the code, applies the change)
// ============================================
router.post('/confirm-email-change', verifyEmailChangeLimiter, async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  const code = typeof req.body.code === 'string' ? req.body.code : '';

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: 'Enter the six digit code.' });
  }

  try {
    const outcome = await db.transaction(async (client) => {
      const result = await client.query(`
        SELECT change_id, new_email, code
        FROM pending_email_changes
        WHERE user_id = $1 AND is_used = FALSE
          AND attempts < 5 AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [req.session.userId]);
      if (result.rows.length === 0) return { status: 'invalid' };

      const row = result.rows[0];
      if (row.code !== code) {
        await client.query(`
          UPDATE pending_email_changes
          SET attempts = attempts + 1, is_used = (attempts + 1 >= 5)
          WHERE change_id = $1
        `, [row.change_id]);
        return { status: 'invalid' };
      }

      const existing = await client.query(
        'SELECT user_id FROM users WHERE LOWER(email) = $1 AND user_id != $2',
        [row.new_email, req.session.userId]
      );
      if (existing.rows.length > 0) return { status: 'email_taken' };

      await client.query('UPDATE users SET email = $1 WHERE user_id = $2', [row.new_email, req.session.userId]);
      await client.query('UPDATE pending_email_changes SET is_used = TRUE WHERE change_id = $1', [row.change_id]);
      return { status: 'updated', newEmail: row.new_email };
    });

    if (outcome.status === 'email_taken') {
      return res.status(409).json({ message: 'This email is already in use by another account.' });
    }
    if (outcome.status !== 'updated') {
      return res.status(400).json({ message: 'Invalid, expired, or locked verification code. Request a new one.' });
    }

    return res.status(200).json({ message: 'Email address updated successfully.', newEmail: outcome.newEmail });
  } catch (error) {
    console.log('Confirm email change error:', error);
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
      message: 'Password must be between 8 and 72 characters.',
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
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail) {
    return res.status(400).json({ message: 'Email address is required.' });
  }

  const genericResponse = { message: 'If an account exists for this email, a reset link will be sent.' };
  try {
    const userResult = await db.query('SELECT user_id, email FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
    const user = userResult.rows[0];
    res.status(200).json(genericResponse);
    if (user) {
      setImmediate(async () => {
        try {
      const recentTokens = await db.query(`
        SELECT COUNT(*)::integer AS count
        FROM password_reset_tokens
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
      `, [user.user_id]);
      if (recentTokens.rows[0].count < 3) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const appBaseUrl = new URL(process.env.APP_BASE_URL);
        if (process.env.NODE_ENV === 'production' && appBaseUrl.protocol !== 'https:') {
          throw new Error('APP_BASE_URL must use HTTPS in production.');
        }

        await db.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
          [user.user_id, tokenHash]
        );

        const resetUrl = new URL('/ResetPassword.html', appBaseUrl);
        resetUrl.searchParams.set('token', rawToken);
        sendPasswordResetEmail(user.email, resetUrl.toString())
          .catch((error) => console.error('Could not send password reset email:', error.message));
      }
        } catch (error) {
          console.error('Could not prepare password reset email:', error.message);
        }
      });
    }
  } catch (error) {
    console.error('Forgot password request failed:', error.message);
    if (!res.headersSent) return res.status(200).json(genericResponse);
  }
  return undefined;
});

// ============================================
// ROUTE 6: RESET PASSWORD (Set a new password)
// ============================================
router.post('/reset-password', forgotPasswordLimiter, async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ message: 'Token and new password are required.' });
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({
      message: 'Password must be between 8 and 72 characters.',
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