// routes/auth.js
// Dito nakapaloob ang lahat ng logic para sa Register, Verify OTP, Resend OTP,
// Login, Forgot Password, Reset Password, at Logout. Bawat "router.post(...)"
// sa ibaba ay parang isang hiwalay na "pinto" na may sariling gawain.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
// Ginagamit natin ang bcryptjs para i-"hash" ang password bago i-save.
// Ang crypto (built-in sa Node) ay ginagamit natin para gumawa ng random
// na reset tokens para sa forgot password feature.

const router = express.Router();
// Ang "Router" ay parang isang mini-server na nakatuon lang sa
// isang specific na grupo ng routes (dito, lahat ng related sa "auth").

const db = require('../db'); // gagamitin natin ito para mag-query sa database
const { sendOtpEmail, sendPasswordResetEmail } = require('../utils/mailer'); // para makapagpadala ng totoong email

function gumawaNgOtpCode() {
  // Gumagawa ito ng random na 6 digit na numero, hal. "042917"
  const randomNumber = Math.floor(100000 + Math.random() * 900000);
  return String(randomNumber);
}

// ============================================
// ROUTE 1: REGISTER (Gumawa ng bagong account)
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

  let bagongUser = null;

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
      const freshOtpCode = gumawaNgOtpCode();
      await db.query(
        `INSERT INTO otp_codes (user_id, code, purpose, expires_at)
         VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '5 minutes')`,
        [foundUser.user_id, freshOtpCode]
      );
      await sendOtpEmail(normalizedEmail, freshOtpCode);

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

    bagongUser = insertResult.rows[0];

    const otpCode = gumawaNgOtpCode();
    await db.query(
      `INSERT INTO otp_codes (user_id, code, purpose, expires_at)
       VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '5 minutes')`,
      [bagongUser.user_id, otpCode]
    );

    // If this next line fails (e.g. email service is misconfigured),
    // the catch block below will undo the user we just created —
    // so retrying registration with the same email works cleanly.
    await sendOtpEmail(bagongUser.email, otpCode);

    res.status(201).json({
      message: 'Account created. Check email for verification code.',
      userId: bagongUser.user_id,
    });
  } catch (error) {
    console.log('Registration Error:', error);

    // Rollback: if we already created the user row but something
    // after that failed (like the email), delete the half-finished
    // account so the email becomes available again for retry.
    if (bagongUser) {
      try {
        await db.query('DELETE FROM users WHERE user_id = $1', [bagongUser.user_id]);
      } catch (rollbackError) {
        console.log('Rollback error:', rollbackError);
      }
    }

    res.status(500).json({ message: 'Error. Try Again.' });
  }
});

// ============================================
// ROUTE 2: VERIFY OTP (I-verify ang 6-digit code)
// ============================================
router.post('/verify-otp', async (req, res) => {
  const { userId, code } = req.body;

  if (!userId || !code) {
    return res.status(400).json({ message: ' Enter six digit code.' });
  }

  try {
    // Note: expiration is now checked directly in SQL (expires_at > NOW())
    // instead of comparing dates in JavaScript, to avoid timezone mismatch
    // issues between the server and the database.
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

    res.status(200).json({ message: 'Successful Email verification.' });
  } catch (error) {
    console.log('OTP verification error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 3: RESEND OTP (Magpadala ng bagong code)
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

    const bagongOtpCode = gumawaNgOtpCode();
    await db.query(
      `INSERT INTO otp_codes (user_id, code, purpose, expires_at)
       VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '5 minutes')`,
      [userId, bagongOtpCode]
    );

    await sendOtpEmail(userEmail, bagongOtpCode);

    res.status(200).json({ message: 'Code has been sent.' });
  } catch (error) {
    console.log('There has been an error while resending Otp code:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 4: LOGIN
// ============================================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: 'Email and password required.' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Incorrect Email or Password' });
    }

    const user = result.rows[0];

    const tamaAngPassword = await bcrypt.compare(password, user.password_hash);
    if (!tamaAngPassword) {
      return res.status(401).json({ message: 'Invalid Email o Password.' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ message: 'Verify Email to login.' });
    }

    const dashboardPerRole = {
      client: '/index.html',
      admin: '/AdminDashboard.html',
      aesthetician: '/AestheticianDashboard.html',
      inventory_officer: '/InventoryDashboard.html',
      finance_officer: '/FinanceDashboard.html',
      staff: '/StaffDashboard.html',
    };

    // Save the user's ID into the session — this is what keeps them
    // "logged in" across future requests
    req.session.userId = user.user_id;
    req.session.role = user.role;

    res.status(200).json({
      message: 'Successful login.',
      userId: user.user_id,
      role: user.role,
      redirectUrl: dashboardPerRole[user.role] || '/dashboard',
    });
  } catch (error) {
    console.log('Error login:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 5: FORGOT PASSWORD (Magpadala ng reset link)
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
      return res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
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

    res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    console.log('Forgot password error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE 6: RESET PASSWORD (Gumawa ng bagong password)
// ============================================
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ message: 'Token and new password are required.' });
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
// Ie-export natin ang router na 'to papunta sa index.js, dun ginagamit
// gamit ang "app.use('/api/auth', require('./routes/auth'))"