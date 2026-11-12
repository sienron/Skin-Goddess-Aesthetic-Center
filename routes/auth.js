// routes/auth.js
// Contains all the logic for Register, Verify OTP, Resend OTP,
// Login, Forgot Password, Reset Password, and Logout. Each
// "router.post(...)" below is like a separate "door" with its own job.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const QRCode = require('qrcode');
// bcryptjs is used to hash passwords before saving them.
// crypto (built into Node) is used to generate random reset tokens
// for the forgot password feature.

const router = express.Router();
// The Router is like a mini-server focused on one specific
// group of routes (here, everything related to "auth").

const db = require('../db'); // used to query the database
const { sendOtpEmail, sendPasswordResetEmail } = require('../utils/mailer'); // for sending actual emails
const isValidPassword = require('../utils/password');
const { DASHBOARD_PER_ROLE, STAFF_ROLES } = require('../utils/roleRoutes');
const { isDemoCustomer, isDemoCustomerAccount } = require('../utils/demoMode');
const { createPreserveDemoCustomerAccess } = require('../utils/demoCustomerAccess');
const { isValidName, isValidEmail } = require('../utils/userValidation');
const { hashOtpCode, verifyOtpCode } = require('../utils/otpSecurity');
const { isPrivilegedRole } = require('../utils/privilegedMfa');
const { getSessionMaxAge } = require('../utils/sessionSecurity');
const {
  createTotpSecret,
  matchTotpStep,
  createTotpUri,
  encryptTotpSecret,
  decryptTotpSecret,
  createRecoveryCodes,
  hashRecoveryCode,
  hashEnrollmentCode,
} = require('../utils/totp');

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, message: { message: 'Too many registration attempts. Try again later.' } });
const verifyOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many verification attempts. Try again later.' } });
const resendOtpLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, message: { message: 'Too many code requests. Try again later.' } });
const resendOtpCooldownLimiter = rateLimit({ windowMs: 60 * 1000, limit: 1, message: { message: 'Please wait 60 seconds before requesting another code.' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many sign-in attempts. Try again later.' } });
const loginOtpVerifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many verification attempts. Try again later.' } });
const privilegedMfaVerifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, message: { message: 'Too many MFA attempts. Try again later.' } });
const privilegedMfaEnrollmentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, message: { message: 'Too many enrollment attempts. Try again later.' } });
const loginOtpResendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, message: { message: 'Too many code requests. Try again later.' } });
const loginOtpResendCooldownLimiter = rateLimit({ windowMs: 60 * 1000, limit: 1, message: { message: 'Please wait 60 seconds before requesting another code.' } });
const forgotPasswordLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, message: { message: 'Too many reset requests. Try again later.' } });
const emailChangeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, message: { message: 'Too many code requests. Try again later.' } });
const emailChangeCooldownLimiter = rateLimit({ windowMs: 60 * 1000, limit: 1, message: { message: 'Please wait 60 seconds before requesting another code.' } });
const verifyEmailChangeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many verification attempts. Try again later.' } });
const DUMMY_PASSWORD_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
const REMEMBERED_DEVICE_COOKIE_PREFIX = 'sg_remembered_device_';
const LEGACY_REMEMBERED_DEVICE_COOKIE = 'sg_remembered_device';
const REMEMBERED_DEVICE_MAX_AGE = 1000 * 60 * 60 * 24 * 30;
<<<<<<< HEAD
=======
const STAY_SIGNED_IN_MAX_AGE = 1000 * 60 * 60 * 24 * 30;
>>>>>>> bcf72bbc4dd3caf1433b42273d1a5dd7a70911dd
const PRIVILEGED_MFA_PENDING_MS = 10 * 60 * 1000;
const preserveDemoCustomerAccess = createPreserveDemoCustomerAccess(db);

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function getCookieValue(req, name) {
  const prefix = `${name}=`;
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const cookie = item.trim();
    if (cookie.startsWith(prefix)) {
      try {
        return decodeURIComponent(cookie.slice(prefix.length));
      } catch (error) {
        return null;
      }
    }
  }
  return null;
}

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function rememberedDeviceCookieName(userId) {
  return `${REMEMBERED_DEVICE_COOKIE_PREFIX}${userId}`;
}

async function revokeUserSessions(client, userId) {
  await client.query(`
    DELETE FROM user_sessions
    WHERE sess->>'userId' = $1
       OR sess->>'pendingLoginUserId' = $1
       OR sess->>'pendingPrivilegedMfaUserId' = $1
  `, [String(userId)]);
}

function clearPendingPrivilegedMfa(req) {
  delete req.session.pendingPrivilegedMfaUserId;
  delete req.session.pendingPrivilegedMfaStage;
  delete req.session.pendingPrivilegedMfaExpiresAt;
  delete req.session.pendingPrivilegedMfaStaySignedIn;
}

function hasPendingPrivilegedMfa(req) {
  return Number.isSafeInteger(Number(req.session.pendingPrivilegedMfaUserId))
    && Number(req.session.pendingPrivilegedMfaExpiresAt) > Date.now();
}

async function beginPrivilegedMfa(req, user, stage, staySignedIn) {
  await regenerateSession(req);
  req.session.pendingPrivilegedMfaUserId = user.user_id;
  req.session.pendingPrivilegedMfaStage = stage;
  req.session.pendingPrivilegedMfaExpiresAt = Date.now() + PRIVILEGED_MFA_PENDING_MS;
  req.session.pendingPrivilegedMfaStaySignedIn = staySignedIn;
  req.session.cookie.maxAge = PRIVILEGED_MFA_PENDING_MS;
}

async function establishPrivilegedAuthenticatedSession(req, user) {
  const enrolledAt = new Date(user.totp_enrolled_at).getTime();
  const staySignedIn = req.session.pendingPrivilegedMfaStaySignedIn === true;
  await establishAuthenticatedSession(req, user, staySignedIn);
  req.session.mfaVerifiedAt = enrolledAt;
  req.session.privilegedMfaAuthenticatedAt = Date.now();
}

async function writeMfaAudit(client, userId, eventType) {
  await client.query(
    'INSERT INTO privileged_mfa_audit (user_id, event_type) VALUES ($1, $2)',
    [userId, eventType]
  );
}

async function markExpiredMfaEnrollmentCodes(client, userId = null) {
  const values = userId === null ? [] : [userId];
  const filter = userId === null ? '' : 'AND user_id = $1';
  const expiredCodes = await client.query(`
    UPDATE privileged_mfa_enrollment_codes
    SET expired_at = expires_at
    WHERE used_at IS NULL AND expired_at IS NULL AND revoked_at IS NULL
      AND expires_at <= NOW() ${filter}
    RETURNING user_id
  `, values);
  for (const row of expiredCodes.rows) {
    await writeMfaAudit(client, row.user_id, 'enrollment_code_expired');
  }

  const expiredSetups = await client.query(`
    DELETE FROM privileged_mfa_pending_enrollments
    WHERE expires_at <= NOW() ${userId === null ? '' : 'AND user_id = $1'}
    RETURNING user_id
  `, values);
  for (const row of expiredSetups.rows) {
    await writeMfaAudit(client, row.user_id, 'enrollment_expired');
  }
}

async function storeRecoveryCodes(client, userId, codes) {
  await client.query('DELETE FROM privileged_mfa_recovery_codes WHERE user_id = $1', [userId]);
  for (const code of codes) {
    await client.query(
      'INSERT INTO privileged_mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)',
      [userId, hashRecoveryCode(code)]
    );
  }
}

function destroyCurrentSession(req, res) {
  return new Promise((resolve) => {
    req.session.destroy((error) => {
      if (error) {
        console.error('Could not destroy the current session after password update:', error);
      }
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      resolve();
    });
  });
}

function rememberedDeviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

async function establishAuthenticatedSession(req, user, staySignedIn) {
  await regenerateSession(req);
  req.session.userId = user.user_id;
  req.session.role = user.role;
  if (staySignedIn) {
    req.session.staySignedIn = true;
  }
  const maxAge = getSessionMaxAge(req.session);
  req.session.sessionExpiresAt = Date.now() + maxAge;
  req.session.cookie.maxAge = maxAge;
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

async function recentLoginOtpCount(userId) {
  const result = await db.query(`
    SELECT COUNT(*)::integer AS count
    FROM otp_codes
    WHERE user_id = $1 AND purpose = 'login_verification'
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

async function issueOtpCode(userId, purpose, expiresInMinutes = 5) {
  const code = generateOtpCode();
  const codeHash = hashOtpCode(code, userId, purpose);

  await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${purpose}:${userId}`]);
    await client.query(
      'UPDATE otp_codes SET is_used = TRUE WHERE user_id = $1 AND purpose = $2 AND is_used = FALSE',
      [userId, purpose]
    );
    await client.query(
      `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'))`,
      [userId, codeHash, purpose, expiresInMinutes]
    );
  });

  return { code, codeHash };
}

async function issueEmailChangeCode(userId, email) {
  const code = generateOtpCode();
  const codeHash = hashOtpCode(code, userId, 'email_change');

  await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:email_change:${userId}`]);
    await client.query(
      'UPDATE pending_email_changes SET is_used = TRUE WHERE user_id = $1 AND is_used = FALSE',
      [userId]
    );
    await client.query(
      `INSERT INTO pending_email_changes (user_id, new_email, code_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
      [userId, email, codeHash]
    );
  });

  return { code, codeHash };
}

async function invalidateOtpCode(userId, purpose, codeHash) {
  await db.query(
    `UPDATE otp_codes SET is_used = TRUE
     WHERE user_id = $1 AND purpose = $2 AND code_hash = $3 AND is_used = FALSE`,
    [userId, purpose, codeHash]
  );
}

async function invalidateEmailChangeCode(userId, codeHash) {
  await db.query(
    `UPDATE pending_email_changes SET is_used = TRUE
     WHERE user_id = $1 AND code_hash = $2 AND is_used = FALSE`,
    [userId, codeHash]
  );
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
  } = req.body;

  const normalizedFirstName = typeof firstName === 'string' ? firstName.trim() : '';
  const normalizedLastName = typeof lastName === 'string' ? lastName.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!isValidName(normalizedFirstName) || !isValidName(normalizedLastName)
    || !isValidEmail(normalizedEmail)) {
    return res.status(400).json({ message: 'Fill out all the fields' });
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
      const { code: freshOtpCode, codeHash } = await issueOtpCode(foundUser.user_id, 'email_verification');

      try {
        await sendOtpEmail(normalizedEmail, freshOtpCode);
      } catch (emailError) {
        console.error('Registration verification email delivery failed.');
        await invalidateOtpCode(foundUser.user_id, 'email_verification', codeHash);
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

    const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    const insertResult = await db.query(
      `INSERT INTO users
        (email, password_hash, first_name, last_name, date_of_birth, gender,
         civil_status, contact_number, home_address, allergies, medical_conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING user_id, email`,
      [
        normalizedEmail,
        unusablePasswordHash,
        normalizedFirstName,
        normalizedLastName,
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

    const { code: otpCode, codeHash: registrationCodeHash } = await issueOtpCode(newUser.user_id, 'email_verification');

    try {
      await sendOtpEmail(newUser.email, otpCode);
    } catch (emailError) {
      console.error('Registration verification email delivery failed.');
      await invalidateOtpCode(newUser.user_id, 'email_verification', registrationCodeHash);
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
    const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const outcome = await db.transaction(async (client) => {
      const otpResult = await client.query(`
        SELECT otp_id, code_hash, attempts
        FROM otp_codes
        WHERE user_id = $1 AND purpose = 'email_verification'
          AND is_used = FALSE AND expires_at > NOW() AND attempts < 5
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [userId]);
      if (otpResult.rows.length === 0) return 'invalid';

      const otp = otpResult.rows[0];
      if (!verifyOtpCode(code, otp.code_hash, userId, 'email_verification')) {
        await client.query(`
          UPDATE otp_codes
          SET attempts = attempts + 1,
              is_used = (attempts + 1 >= 5)
          WHERE otp_id = $1
        `, [otp.otp_id]);
        return 'invalid';
      }

      await client.query('UPDATE otp_codes SET is_used = TRUE WHERE otp_id = $1', [otp.otp_id]);
      await client.query(
        'UPDATE users SET email_verified = TRUE, password_hash = $2 WHERE user_id = $1',
        [userId, unusablePasswordHash]
      );
      return 'verified';
    });

    if (outcome !== 'verified') {
      return res.status(400).json({ message: 'Invalid, expired, or locked verification code.' });
    }

    delete req.session.pendingVerificationUserId;
    req.session.pendingPasswordSetupUserId = userId;
    return res.status(200).json({
      message: 'Email verified. Create a password to finish setting up your account.',
      requiresPasswordSetup: true,
    });
  } catch (error) {
    console.log('OTP verification error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

router.get('/registration-status', (req, res) => {
  res.json({
    requiresPasswordSetup: Number.isSafeInteger(Number(req.session.pendingPasswordSetupUserId))
      && Number(req.session.pendingPasswordSetupUserId) > 0,
  });
});

router.post('/complete-registration', registerLimiter, async (req, res) => {
  const userId = req.session.pendingPasswordSetupUserId;
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!userId) {
    return res.status(401).json({ message: 'Your registration session expired. Start again.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({
      message: 'Password must be 8 to 72 characters and include at least one special character.',
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(`
      UPDATE users SET password_hash = $1
      WHERE user_id = $2 AND role = 'client' AND status = 'active' AND email_verified = TRUE
      RETURNING user_id
    `, [hashedPassword, userId]);

    if (result.rows.length === 0) {
      delete req.session.pendingPasswordSetupUserId;
      return res.status(401).json({ message: 'This registration can no longer be completed. Start again.' });
    }

    delete req.session.pendingPasswordSetupUserId;
    return res.status(200).json({ message: 'Account setup is complete. You can now sign in.' });
  } catch (error) {
    console.error('Registration password setup failed:', error);
    return res.status(500).json({ message: 'Could not complete account setup. Please try again.' });
  }
});

// ============================================
// ROUTE 3: RESEND OTP (Send a new code)
// ============================================
router.post('/resend-otp', resendOtpLimiter, resendOtpCooldownLimiter, async (req, res) => {
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

    const { code: newOtpCode, codeHash } = await issueOtpCode(userId, 'email_verification');

    try {
      await sendOtpEmail(userEmail, newOtpCode);
    } catch (emailError) {
      console.error('Registration verification email resend failed.');
      await invalidateOtpCode(userId, 'email_verification', codeHash);
      return res.status(502).json({ message: 'Could not resend the verification code. Please try again.' });
    }

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
    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !isPasswordValid) {
      return res.status(401).json({ message: 'Incorrect email or password.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Your account is not active.' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ message: 'Verify email to login.' });
    }

    const redirectUrl = DASHBOARD_PER_ROLE[user.role];
    if (!redirectUrl) {
      return res.status(403).json({ message: 'Your account role does not have an assigned destination.' });
    }

    if (isPrivilegedRole(user.role)) {
      const stage = user.totp_enabled === true ? 'totp' : 'enrollment';
      await beginPrivilegedMfa(req, user, stage, staysignedin === true);
      return res.status(200).json({
        message: stage === 'totp' ? 'Enter your authenticator code.' : 'Privileged account enrollment is required.',
        requiresMfa: true,
        mfaMethod: stage,
      });
    }

    const demoCustomerMfaExempt = user.role === 'client' && isDemoCustomer(user);
    const localDevMfaBypass = process.env.NODE_ENV === 'development'
      && !isPrivilegedRole(user.role)
      && user.mfa_enabled === false;
    if (demoCustomerMfaExempt || localDevMfaBypass) {
      await establishAuthenticatedSession(req, user, Boolean(staysignedin));
      return res.status(200).json({
        message: demoCustomerMfaExempt ? 'Successful login.' : 'Successful local development login.',
        userId: user.user_id,
        role: user.role,
        redirectUrl,
      });
    }

    if (STAFF_ROLES.includes(user.role)) {
      await establishAuthenticatedSession(req, user, Boolean(staysignedin));
      return res.status(200).json({
        message: 'Successful login.',
        userId: user.user_id,
        role: user.role,
        redirectUrl,
      });
    }

    const deviceCookieName = rememberedDeviceCookieName(user.user_id);
    const deviceToken = getCookieValue(req, deviceCookieName);
    const legacyDeviceToken = getCookieValue(req, LEGACY_REMEMBERED_DEVICE_COOKIE);
    const deviceTokenCandidates = [
      { token: deviceToken, legacy: false },
      { token: legacyDeviceToken, legacy: true },
    ].filter(({ token }) => token && /^[a-f\d]{64}$/i.test(token));
    let trustedDevice = null;
    for (const candidate of deviceTokenCandidates) {
      const tokenHash = hashDeviceToken(candidate.token);
      const trustedDeviceResult = await db.query(`
        SELECT device_id
        FROM trusted_login_devices
        WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()
        LIMIT 1
      `, [user.user_id, tokenHash]);

      if (trustedDeviceResult.rows.length > 0) {
        trustedDevice = { ...trustedDeviceResult.rows[0], ...candidate };
        break;
      }
    }
    res.clearCookie(LEGACY_REMEMBERED_DEVICE_COOKIE, rememberedDeviceCookieOptions());
    if (trustedDevice) {
      await db.query(
        'UPDATE trusted_login_devices SET last_used_at = NOW() WHERE device_id = $1',
        [trustedDevice.device_id]
      );
      if (trustedDevice.legacy) {
        res.cookie(deviceCookieName, trustedDevice.token, {
          ...rememberedDeviceCookieOptions(),
          maxAge: REMEMBERED_DEVICE_MAX_AGE,
        });
      }
      await establishAuthenticatedSession(req, user, Boolean(staysignedin));
      return res.status(200).json({
        message: 'Successful login.',
        userId: user.user_id,
        role: user.role,
        redirectUrl,
      });
    }
    if (deviceToken) {
      res.clearCookie(deviceCookieName, rememberedDeviceCookieOptions());
    }

    if (await recentLoginOtpCount(user.user_id) >= 5) {
      return res.status(429).json({ message: 'Too many sign-in codes requested. Try again later.' });
    }

    const { code, codeHash } = await issueOtpCode(user.user_id, 'login_verification');

    try {
      await sendOtpEmail(user.email, code);
    } catch {
      console.error('Sign-in verification email delivery failed.');
      await invalidateOtpCode(user.user_id, 'login_verification', codeHash);
      return res.status(502).json({ message: 'Could not send a sign-in code. Please try again.' });
    }

    await regenerateSession(req);
    req.session.pendingLoginUserId = user.user_id;
    req.session.pendingLoginStaySignedIn = Boolean(staysignedin);

    res.status(200).json({
      message: 'A sign-in verification code has been sent to your email.',
      requiresMfa: true,
      mfaMethod: 'email_otp',
    });
  } catch (error) {
    console.log('Login error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

router.post('/mfa/enrollment/start', privilegedMfaEnrollmentLimiter, async (req, res) => {
  if (!hasPendingPrivilegedMfa(req)) {
    clearPendingPrivilegedMfa(req);
    return res.status(401).json({ message: 'Your privileged sign-in session expired. Sign in again.' });
  }

  const userId = req.session.pendingPrivilegedMfaUserId;
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const secret = createTotpSecret();

  try {
    const encryptedSecret = encryptTotpSecret(secret);
    const outcome = await db.transaction(async (client) => {
      await markExpiredMfaEnrollmentCodes(client, userId);
      const userResult = await client.query(
        'SELECT role, status, email_verified FROM users WHERE user_id = $1 FOR UPDATE',
        [userId]
      );
      const user = userResult.rows[0];
      if (!user || !isPrivilegedRole(user.role) || user.status !== 'active' || !user.email_verified) {
        return { status: 'account_unavailable' };
      }

      const codeResult = await client.query(`
        SELECT enrollment_code_id, code_hash, expires_at, attempts
        FROM privileged_mfa_enrollment_codes
        WHERE user_id = $1 AND used_at IS NULL AND expired_at IS NULL
          AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [userId]);
      const enrollmentCode = codeResult.rows[0];
      if (!enrollmentCode || !/^[A-Za-z0-9_-]{32}$/.test(code)) {
        await writeMfaAudit(client, userId, 'enrollment_failed');
        return { status: 'invalid' };
      }

      if (new Date(enrollmentCode.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE privileged_mfa_enrollment_codes
           SET expired_at = expires_at WHERE enrollment_code_id = $1`,
          [enrollmentCode.enrollment_code_id]
        );
        await writeMfaAudit(client, userId, 'enrollment_code_expired');
        return { status: 'expired' };
      }

      const matches = crypto.timingSafeEqual(
        Buffer.from(hashEnrollmentCode(code)),
        Buffer.from(enrollmentCode.code_hash)
      );
      if (!matches || enrollmentCode.attempts >= 5) {
        await client.query(`
          UPDATE privileged_mfa_enrollment_codes
          SET attempts = attempts + 1,
              revoked_at = CASE WHEN attempts + 1 >= 5 THEN NOW() ELSE revoked_at END
          WHERE enrollment_code_id = $1
        `, [enrollmentCode.enrollment_code_id]);
        await writeMfaAudit(client, userId, 'enrollment_failed');
        return { status: 'invalid' };
      }

      await client.query(
        'UPDATE privileged_mfa_enrollment_codes SET used_at = NOW() WHERE enrollment_code_id = $1',
        [enrollmentCode.enrollment_code_id]
      );
      await client.query(`
        INSERT INTO privileged_mfa_pending_enrollments
          (user_id, secret_ciphertext, secret_iv, secret_tag, expires_at, attempts)
        VALUES ($1, $2, $3, $4, $5, 0)
        ON CONFLICT (user_id) DO UPDATE SET
          secret_ciphertext = EXCLUDED.secret_ciphertext,
          secret_iv = EXCLUDED.secret_iv,
          secret_tag = EXCLUDED.secret_tag,
          expires_at = EXCLUDED.expires_at,
          attempts = 0,
          created_at = NOW()
      `, [
        userId,
        encryptedSecret.ciphertext,
        encryptedSecret.iv,
        encryptedSecret.tag,
        enrollmentCode.expires_at,
      ]);
      await writeMfaAudit(client, userId, 'enrollment_code_redeemed');
      return { status: 'ready', expiresAt: enrollmentCode.expires_at };
    });

    if (outcome.status !== 'ready') {
      if (outcome.status === 'account_unavailable') clearPendingPrivilegedMfa(req);
      return res.status(outcome.status === 'account_unavailable' ? 403 : 400).json({
        message: outcome.status === 'account_unavailable'
          ? 'This account cannot enroll. Contact the system operator.'
          : 'Enrollment code is invalid, expired, or locked.',
      });
    }

    const userResult = await db.query('SELECT email FROM users WHERE user_id = $1', [userId]);
    const uri = createTotpUri(secret, userResult.rows[0].email);
    const qrCodeDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 2, width: 220 });
    req.session.pendingPrivilegedMfaStage = 'enrollment_confirm';
    req.session.pendingPrivilegedMfaExpiresAt = new Date(outcome.expiresAt).getTime();
    return res.status(200).json({ qrCodeDataUrl, secret, expiresAt: outcome.expiresAt });
  } catch (error) {
    console.error('Privileged MFA enrollment setup failed:', error.message);
    return res.status(500).json({ message: 'Could not start MFA enrollment. Please contact the system operator.' });
  }
});

router.post('/mfa/enrollment/verify', privilegedMfaVerifyLimiter, async (req, res) => {
  if (!hasPendingPrivilegedMfa(req)
    || req.session.pendingPrivilegedMfaStage !== 'enrollment_confirm') {
    clearPendingPrivilegedMfa(req);
    return res.status(401).json({ message: 'Your enrollment session expired. Sign in again.' });
  }

  const userId = req.session.pendingPrivilegedMfaUserId;
  const code = typeof req.body.code === 'string' ? req.body.code : '';
  const recoveryCodes = createRecoveryCodes();
  try {
    const outcome = await db.transaction(async (client) => {
      await markExpiredMfaEnrollmentCodes(client, userId);
      const userResult = await client.query(
        'SELECT user_id, role, status, email_verified FROM users WHERE user_id = $1 FOR UPDATE',
        [userId]
      );
      const user = userResult.rows[0];
      if (!user || !isPrivilegedRole(user.role) || user.status !== 'active' || !user.email_verified) {
        return { status: 'account_unavailable' };
      }

      const pendingResult = await client.query(`
        SELECT secret_ciphertext, secret_iv, secret_tag, expires_at, attempts
        FROM privileged_mfa_pending_enrollments WHERE user_id = $1 FOR UPDATE
      `, [userId]);
      const pending = pendingResult.rows[0];
      if (!pending) return { status: 'expired' };
      if (new Date(pending.expires_at).getTime() <= Date.now()) {
        await client.query('DELETE FROM privileged_mfa_pending_enrollments WHERE user_id = $1', [userId]);
        await writeMfaAudit(client, userId, 'enrollment_expired');
        return { status: 'expired' };
      }
      if (pending.attempts >= 5) return { status: 'locked' };

      const secret = decryptTotpSecret({
        ciphertext: pending.secret_ciphertext,
        iv: pending.secret_iv,
        tag: pending.secret_tag,
      });
      const matchedStep = matchTotpStep(secret, code);
      if (matchedStep === null) {
        await client.query(`
          UPDATE privileged_mfa_pending_enrollments
          SET attempts = attempts + 1
          WHERE user_id = $1
        `, [userId]);
        await writeMfaAudit(client, userId, 'enrollment_failed');
        return { status: 'invalid' };
      }

      const encryptedSecret = {
        ciphertext: pending.secret_ciphertext,
        iv: pending.secret_iv,
        tag: pending.secret_tag,
      };
      const updatedUser = await client.query(`
        UPDATE users SET
          totp_enabled = TRUE,
          totp_secret_ciphertext = $2,
          totp_secret_iv = $3,
          totp_secret_tag = $4,
          totp_enrolled_at = NOW(),
          totp_last_used_step = $5
        WHERE user_id = $1
        RETURNING user_id, role, totp_enrolled_at
      `, [userId, encryptedSecret.ciphertext, encryptedSecret.iv, encryptedSecret.tag, matchedStep]);

      await storeRecoveryCodes(client, userId, recoveryCodes);
      await client.query('DELETE FROM privileged_mfa_pending_enrollments WHERE user_id = $1', [userId]);
      await client.query(`
        UPDATE privileged_mfa_enrollment_codes
        SET revoked_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL AND expired_at IS NULL AND revoked_at IS NULL
      `, [userId]);
      await writeMfaAudit(client, userId, 'enrollment_succeeded');
      await revokeUserSessions(client, userId);
      return { status: 'success', user: updatedUser.rows[0] };
    });

    if (outcome.status !== 'success') {
      if (outcome.status === 'account_unavailable') clearPendingPrivilegedMfa(req);
      return res.status(outcome.status === 'account_unavailable' ? 403 : 400).json({
        message: outcome.status === 'account_unavailable'
          ? 'This account cannot enroll. Contact the system operator.'
          : 'Authenticator code is invalid, expired, or locked.',
      });
    }

    await establishPrivilegedAuthenticatedSession(req, outcome.user);
    return res.status(200).json({
      message: 'MFA enrollment is complete. Save your recovery codes now.',
      redirectUrl: DASHBOARD_PER_ROLE[outcome.user.role],
      recoveryCodes,
    });
  } catch (error) {
    console.error('Privileged MFA enrollment verification failed:', error.message);
    return res.status(500).json({ message: 'Could not verify MFA enrollment.' });
  }
});

router.post('/login/verify-totp', privilegedMfaVerifyLimiter, async (req, res) => {
  if (!hasPendingPrivilegedMfa(req)
    || req.session.pendingPrivilegedMfaStage !== 'totp') {
    clearPendingPrivilegedMfa(req);
    return res.status(401).json({ message: 'Your privileged sign-in session expired. Sign in again.' });
  }

  const userId = req.session.pendingPrivilegedMfaUserId;
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  try {
    const userResult = await db.query(`
      SELECT user_id, email, role, status, email_verified, totp_enabled,
             totp_secret_ciphertext, totp_secret_iv, totp_secret_tag,
             totp_enrolled_at, totp_last_used_step
      FROM users WHERE user_id = $1
    `, [userId]);
    const user = userResult.rows[0];
    if (!user || !isPrivilegedRole(user.role) || user.status !== 'active'
      || !user.email_verified || user.totp_enabled !== true || !user.totp_enrolled_at) {
      clearPendingPrivilegedMfa(req);
      return res.status(403).json({ message: 'This account cannot sign in. Contact the system operator.' });
    }

    let matchedStep = null;
    let isRecoveryCode = false;
    if (/^\d{6}$/.test(code)) {
      if (user.totp_secret_ciphertext) {
        const secret = decryptTotpSecret({
          ciphertext: user.totp_secret_ciphertext,
          iv: user.totp_secret_iv,
          tag: user.totp_secret_tag,
        });
        matchedStep = matchTotpStep(secret, code);
      }
    } else if (/^[A-Fa-f0-9-]{24,28}$/.test(code)) {
      isRecoveryCode = true;
    }

    const rotatedRecoveryCodes = isRecoveryCode ? createRecoveryCodes() : [];
    const outcome = await db.transaction(async (client) => {
      const currentUserResult = await client.query(
        `SELECT user_id, role, status, email_verified, totp_enabled, totp_enrolled_at,
                totp_last_used_step
         FROM users WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );
      const currentUser = currentUserResult.rows[0];
      if (!currentUser || !isPrivilegedRole(currentUser.role) || currentUser.status !== 'active'
        || !currentUser.email_verified
        || currentUser.totp_enabled !== true || !currentUser.totp_enrolled_at) {
        return { status: 'account_unavailable' };
      }

      const recentFailures = await client.query(`
        SELECT COUNT(*)::integer AS count
        FROM privileged_mfa_audit
        WHERE user_id = $1 AND event_type = 'login_failed'
          AND occurred_at > NOW() - INTERVAL '15 minutes'
      `, [userId]);
      if (recentFailures.rows[0].count >= 5) return { status: 'rate_limited' };

      if (isRecoveryCode) {
        const used = await client.query(`
          UPDATE privileged_mfa_recovery_codes SET used_at = NOW()
          WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
          RETURNING recovery_code_id
        `, [userId, hashRecoveryCode(code)]);
        if (used.rows.length === 0) {
          await writeMfaAudit(client, userId, 'login_failed');
          return { status: 'invalid' };
        }
        await storeRecoveryCodes(client, userId, rotatedRecoveryCodes);
        await writeMfaAudit(client, userId, 'recovery_code_used');
      } else if (matchedStep === null
        || (currentUser.totp_last_used_step !== null
          && currentUser.totp_last_used_step !== undefined
          && BigInt(currentUser.totp_last_used_step) >= BigInt(matchedStep))) {
        await writeMfaAudit(client, userId, 'login_failed');
        return { status: 'invalid' };
      } else {
        const consumed = await client.query(`
          UPDATE users SET totp_last_used_step = $2
          WHERE user_id = $1 AND (totp_last_used_step IS NULL OR totp_last_used_step < $2)
          RETURNING user_id
        `, [userId, matchedStep]);
        if (consumed.rows.length === 0) {
          await writeMfaAudit(client, userId, 'login_failed');
          return { status: 'invalid' };
        }
      }

      await writeMfaAudit(client, userId, 'login_succeeded');
      return { status: 'success', user: currentUser };
    });

    if (outcome.status !== 'success') {
      if (outcome.status === 'account_unavailable') clearPendingPrivilegedMfa(req);
      if (outcome.status === 'rate_limited') {
        return res.status(429).json({ message: 'Too many MFA attempts. Try again later.' });
      }
      return res.status(outcome.status === 'account_unavailable' ? 403 : 400).json({
        message: outcome.status === 'account_unavailable'
          ? 'This account cannot sign in. Contact the system operator.'
          : 'Authenticator or recovery code is invalid.',
      });
    }

    await establishPrivilegedAuthenticatedSession(req, outcome.user);
    return res.status(200).json({
      message: 'Successful login.',
      userId: outcome.user.user_id,
      role: outcome.user.role,
      redirectUrl: DASHBOARD_PER_ROLE[outcome.user.role],
      recoveryCodes: rotatedRecoveryCodes.length ? rotatedRecoveryCodes : undefined,
    });
  } catch (error) {
    console.error('Privileged MFA verification failed:', error.message);
    return res.status(500).json({ message: 'Could not verify MFA.' });
  }
});

router.post('/login/verify-otp', loginOtpVerifyLimiter, async (req, res) => {
  const userId = req.session.pendingLoginUserId;
  const code = typeof req.body.code === 'string' ? req.body.code : '';

  if (!userId || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: 'Enter the six-digit sign-in code.' });
  }

  try {
    const outcome = await db.transaction(async (client) => {
      const otpResult = await client.query(`
        SELECT otp_id, code_hash
        FROM otp_codes
        WHERE user_id = $1 AND purpose = 'login_verification'
          AND is_used = FALSE AND expires_at > NOW() AND attempts < 5
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [userId]);
      if (otpResult.rows.length === 0) return 'invalid';

      const otp = otpResult.rows[0];
      if (!verifyOtpCode(code, otp.code_hash, userId, 'login_verification')) {
        await client.query(`
          UPDATE otp_codes
          SET attempts = attempts + 1,
              is_used = (attempts + 1 >= 5)
          WHERE otp_id = $1
        `, [otp.otp_id]);
        return 'invalid';
      }

      await client.query('UPDATE otp_codes SET is_used = TRUE WHERE otp_id = $1', [otp.otp_id]);
      return 'verified';
    });

    if (outcome !== 'verified') {
      return res.status(400).json({ message: 'Invalid, expired, or locked sign-in code.' });
    }

    const userResult = await db.query(
      'SELECT user_id, role, status, email_verified FROM users WHERE user_id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    if (!user || user.role !== 'client' || user.status !== 'active' || !user.email_verified) {
      delete req.session.pendingLoginUserId;
      delete req.session.pendingLoginStaySignedIn;
      return res.status(403).json({ message: 'This account cannot sign in. Contact the clinic for help.' });
    }

    const redirectUrl = DASHBOARD_PER_ROLE[user.role];
    if (!redirectUrl) {
      delete req.session.pendingLoginUserId;
      delete req.session.pendingLoginStaySignedIn;
      return res.status(403).json({ message: 'Your account role does not have an assigned destination.' });
    }

    const staySignedIn = req.session.pendingLoginStaySignedIn === true;
    let newDeviceToken = null;

    if (req.body.rememberDevice === true) {
      newDeviceToken = crypto.randomBytes(32).toString('hex');
      await db.query(
        `INSERT INTO trusted_login_devices (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
        [user.user_id, hashDeviceToken(newDeviceToken)]
      );
    }
    await establishAuthenticatedSession(req, user, staySignedIn);
    if (newDeviceToken) {
      res.cookie(rememberedDeviceCookieName(user.user_id), newDeviceToken, {
        ...rememberedDeviceCookieOptions(),
        maxAge: REMEMBERED_DEVICE_MAX_AGE,
      });
    }

    return res.status(200).json({
      message: 'Successful login.',
      userId: user.user_id,
      role: user.role,
      redirectUrl,
    });
  } catch (error) {
    console.log('Login verification error:', error);
    return res.status(500).json({ message: 'Error. Try again.' });
  }
});

router.post('/login/resend-otp', loginOtpResendLimiter, loginOtpResendCooldownLimiter, async (req, res) => {
  const userId = req.session.pendingLoginUserId;
  if (!userId) {
    return res.status(401).json({ message: 'Your sign-in verification session expired. Sign in again.' });
  }

  try {
    const userResult = await db.query(
      'SELECT email, role, status, email_verified FROM users WHERE user_id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    if (!user || user.role !== 'client' || user.status !== 'active' || !user.email_verified) {
      delete req.session.pendingLoginUserId;
      delete req.session.pendingLoginStaySignedIn;
      return res.status(403).json({ message: 'This account cannot sign in. Contact the clinic for help.' });
    }
    if (await recentLoginOtpCount(userId) >= 5) {
      return res.status(429).json({ message: 'Too many sign-in codes requested. Try again later.' });
    }

    const { code, codeHash } = await issueOtpCode(userId, 'login_verification');

    try {
      await sendOtpEmail(user.email, code);
    } catch {
      console.error('Sign-in verification email resend failed.');
      await invalidateOtpCode(userId, 'login_verification', codeHash);
      return res.status(502).json({ message: 'Could not resend the sign-in code. Please try again.' });
    }

    return res.status(200).json({ message: 'A new sign-in code has been sent.' });
  } catch (error) {
    console.log('Login verification resend error:', error);
    return res.status(500).json({ message: 'Error. Try again.' });
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
router.put('/update-profile', preserveDemoCustomerAccess, async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  const { firstName, lastName, contactNumber } = req.body;
  const normalizedFirstName = typeof firstName === 'string' ? firstName.trim() : '';
  const normalizedLastName = typeof lastName === 'string' ? lastName.trim() : '';

  if (!isValidName(normalizedFirstName) || !isValidName(normalizedLastName)) {
    return res.status(400).json({ message: 'Enter valid first and last names.' });
  }

  try {
    await db.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, contact_number = $3
       WHERE user_id = $4`,
      [normalizedFirstName, normalizedLastName, contactNumber || null, req.session.userId]
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
router.post('/request-email-change', emailChangeLimiter, emailChangeCooldownLimiter, preserveDemoCustomerAccess, async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  const { newEmail } = req.body;
  const normalizedEmail = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : '';

  if (!normalizedEmail) {
    return res.status(400).json({ message: 'A new email address is required.' });
  }
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
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

    const { code, codeHash } = await issueEmailChangeCode(req.session.userId, normalizedEmail);

    try {
      await sendOtpEmail(normalizedEmail, code);
    } catch {
      console.error('Email-change verification delivery failed.');
      await invalidateEmailChangeCode(req.session.userId, codeHash);
      return res.status(502).json({ message: 'Could not send the verification code. Please try again.' });
    }

    res.status(200).json({ message: 'A verification code has been sent to your new email address.' });
  } catch (error) {
    console.log('Request email change error:', error);
    res.status(500).json({ message: 'Error. Try again.' });
  }
});

// ============================================
// ROUTE: CONFIRM EMAIL CHANGE (verifies the code, applies the change)
// ============================================
router.post('/confirm-email-change', verifyEmailChangeLimiter, preserveDemoCustomerAccess, async (req, res) => {
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
        SELECT change_id, new_email, code_hash
        FROM pending_email_changes
        WHERE user_id = $1 AND is_used = FALSE
          AND attempts < 5 AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [req.session.userId]);
      if (result.rows.length === 0) return { status: 'invalid' };

      const row = result.rows[0];
      if (!verifyOtpCode(code, row.code_hash, req.session.userId, 'email_change')) {
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
router.put('/change-password', preserveDemoCustomerAccess, async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in.' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required.' });
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({
      message: 'Password must be 8 to 72 characters and include at least one special character.',
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
    await db.transaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [newHash, req.session.userId]);
      await revokeUserSessions(client, req.session.userId);
    });

    await destroyCurrentSession(req, res);
    return res.status(200).json({ message: 'Password changed. All active sessions have been signed out.' });
  } catch (error) {
    console.error('Change password error:', error);
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
    const userResult = await db.query(`
      SELECT user_id, email, role, mfa_enabled
      FROM users WHERE LOWER(email) = $1
    `, [normalizedEmail]);
    const user = userResult.rows[0];
    if (user && !isDemoCustomerAccount(user)) {
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
          try {
            await sendPasswordResetEmail(user.email, resetUrl.toString());
          } catch (error) {
            try {
              await db.query(
                'DELETE FROM password_reset_tokens WHERE token_hash = $1 AND is_used = FALSE',
                [tokenHash]
              );
            } catch (cleanupError) {
              console.error('Could not remove the unsent password reset token:', cleanupError.message);
            }
            throw error;
          }
        }
      } catch (error) {
        console.error('Could not send password reset email:', error.message);
        return res.status(503).json({
          message: 'We could not send a password reset email right now. Please try again later.',
        });
      }
    }
    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error('Forgot password request failed:', error.message);
    return res.status(500).json({ message: 'Could not process the password reset request.' });
  }
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
      message: 'Password must be 8 to 72 characters and include at least one special character.',
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
    const userResult = await db.query(`
      SELECT password_hash, email, role, mfa_enabled
      FROM users WHERE user_id = $1
    `, [
      tokenRow.user_id,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    if (isDemoCustomerAccount(userResult.rows[0])) {
      return res.status(403).json({ message: 'Password resets are disabled for the shared survey account.' });
    }

    const currentPasswordHash = userResult.rows[0].password_hash;

    const isSameAsOldPassword = await bcrypt.compare(newPassword, currentPasswordHash);
    if (isSameAsOldPassword) {
      return res.status(400).json({
        message: 'New password cannot be the same as your old password. Please choose a different one.',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.transaction(async (client) => {
      const usedToken = await client.query(`
        UPDATE password_reset_tokens
        SET is_used = TRUE
        WHERE reset_id = $1 AND user_id = $2 AND is_used = FALSE AND expires_at > NOW()
        RETURNING reset_id
      `, [tokenRow.reset_id, tokenRow.user_id]);
      if (usedToken.rows.length === 0) {
        const error = new Error('Invalid or expired reset link.');
        error.code = 'INVALID_RESET_TOKEN';
        throw error;
      }

      await client.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [
        hashedPassword,
        tokenRow.user_id,
      ]);
      await revokeUserSessions(client, tokenRow.user_id);
    });

    await destroyCurrentSession(req, res);
    return res.status(200).json({ message: 'Password has been reset. All active sessions have been signed out.' });
  } catch (error) {
    if (error.code === 'INVALID_RESET_TOKEN') {
      return res.status(400).json({ message: error.message });
    }
    console.error('Reset password error:', error);
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
