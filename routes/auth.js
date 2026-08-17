// routes/auth.js
// Dito nakapaloob ang lahat ng logic para sa Register, Verify OTP, Resend OTP,
// at Login. Bawat "router.post(...)" sa ibaba ay parang isang hiwalay na
// "pinto" na may sariling gawain.

const express = require('express');
const bcrypt = require('bcryptjs');
// Ginagamit natin ang bcryptjs para i-"hash" ang password bago i-save.
// Ang hashing ay parang isang paraan ng pag-scramble sa password nang
// hindi na ito ma-reverse pabalik — kaya kahit makita ng iba ang laman
// ng database, hindi nila makikita ang totoong password.

const router = express.Router();
// Ang "Router" ay parang isang mini-server na nakatuon lang sa
// isang specific na grupo ng routes (dito, lahat ng related sa "auth").

const db = require('../db'); // gagamitin natin ito para mag-query sa database
const { sendOtpEmail } = require('../utils/mailer'); // para makapagpadala ng totoong email

function gumawaNgOtpCode() {
  // Gumagawa ito ng random na 6 digit na numero, hal. "042917"
  const randomNumber = Math.floor(100000 + Math.random() * 900000);
  return String(randomNumber);
}

// ============================================
// ROUTE 1: REGISTER (Gumawa ng bagong account)
// ============================================
router.post('/register', async (req, res) => {
  // "req.body" ang laman ng data na ipinadala mula sa Registration form
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

  // Step 1: siguraduhing may laman ang mga importanteng fields
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ message: 'Fill out all the fields' });
  }

  try {
    // Step 2: tignan muna kung existing na ang email na 'to sa database
    const existingUser = await db.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      // May nahanap na — ibig sabihin gamit na ang email na 'to
      return res.status(409).json({ message: 'This email has already been used.' });
    }

    // Step 3: i-hash ang password bago i-save (huwag kailanman i-save nang plain text)
    const hashedPassword = await bcrypt.hash(password, 10);
    // Ang "10" ay tinatawag na "salt rounds" — mas mataas na numero, mas
    // matagal pero mas secure ang hashing. 10 ay standard/sapat na.

    // Step 4: i-save ang bagong user sa users table
    const insertResult = await db.query(
      `INSERT INTO users
        (email, password_hash, first_name, last_name, date_of_birth, gender,
         civil_status, contact_number, home_address, allergies, medical_conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING user_id, email`,
      [
        email,
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
    // Ang "$1, $2, $3..." ay mga placeholder — pinapalitan sila ng values
    // sa array sa ibaba nila, sa tamang pagkakasunod-sunod. Ginagawa natin
    // 'to (sa halip na diretsong ilagay ang values sa SQL string) para
    // maiwasan ang isang klase ng attack na tinatawag na "SQL injection".

    const bagongUser = insertResult.rows[0]; // ito yung row na kaka-insert lang natin

    // Step 5: gumawa ng OTP code, i-save sa otp_codes table
    const otpCode = gumawaNgOtpCode();
    await db.query(
      `INSERT INTO otp_codes (user_id, code, purpose, expires_at)
       VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '5 minutes')`,
      [bagongUser.user_id, otpCode]
    );
    // Ang "NOW() + INTERVAL '5 minutes'" ay isang PostgreSQL function —
    // kinukuha ang kasalukuyang oras, dinadagdagan ng 5 minuto. Ito na
    // ang magiging expiration time ng code na 'to.

    // Step 6: ipadala ang OTP code sa totoong email ng user
    await sendOtpEmail(bagongUser.email, otpCode);

    // Step 7: sabihin sa frontend na successful — ibalik din ang userId
    // (kakailanganin 'to sa Verify OTP step mamaya)
    res.status(201).json({
      message: 'Account created. Check email for verification code.',
      userId: bagongUser.user_id,
    });
  } catch (error) {
    console.log('Registration Error:', error);
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
    // Hanapin ang pinaka-bagong code na ginawa para sa user na 'to,
    // na hindi pa nagagamit
    const otpResult = await db.query(
      `SELECT otp_id, code, expires_at
       FROM otp_codes
       WHERE user_id = $1
         AND purpose = 'email_verification'
         AND is_used = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ message: 'Resend code.' });
    }

    const otpRow = otpResult.rows[0];

    // Tignan kung expired na ang code
    const ngayon = new Date();
    const expirationTime = new Date(otpRow.expires_at);
    if (expirationTime < ngayon) {
      return res.status(400).json({ message: 'Code Expired. Resend code.' });
    }

    // Tignan kung tugma ang binigay na code sa nakalagay sa database
    if (otpRow.code !== code) {
      return res.status(400).json({ message: 'Wrong code. Try again.' });
    }

    // Tama ang code! I-mark natin na "gamit" na ito, para hindi na
    // magamit muli (kahit malaman pa ito ng ibang tao)
    await db.query('UPDATE otp_codes SET is_used = TRUE WHERE otp_id = $1', [otpRow.otp_id]);

    // I-mark din natin ang account bilang "verified" na
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

    // Parehong logic lang gaya ng sa Register — gumawa ng bagong code,
    // i-save, ipadala via email
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

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required.' });
  }

  try {
    // Hanapin ang user gamit ang email
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      // Hindi natin sinasabing "walang ganitong email" nang specific —
      // "Invalid email or password" na lang, para hindi malaman ng
      // umaatake kung aling emails ang existing sa system natin
      return res.status(401).json({ message: 'Incorrect Email or Password' });
    }

    const user = result.rows[0];

    // Ikumpara ang binigay na password sa naka-save na hashed password
    const tamaAngPassword = await bcrypt.compare(password, user.password_hash);
    if (!tamaAngPassword) {
      return res.status(401).json({ message: 'Invalid Email o Password.' });
    }

    // Siguraduhing na-verify na ang email bago payagang makapag-login
    if (!user.email_verified) {
      return res.status(403).json({ message: 'Verify Email to login.' });
    }

    // Tama ang lahat! Sabihin sa frontend kung saan siya dapat i-redirect,
    // base sa role niya. (Placeholder pa lang ang mga dashboard pages na 'to.)
    const dashboardPerRole = {
      client: '/UserDashboard.html',
      admin: '/AdminDashboard.html',
      aesthetician: '/AestheticianDashboard.html',
      inventory_officer: '/InventoryDashboard.html',
      finance_officer: '/FinanceDashboard.html',
      staff: '/StaffDashboard.html',
    };

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

module.exports = router;
// Ie-export natin ang router na 'to papunta sa index.js, dun ginagamit
// gamit ang "app.use('/api/auth', require('./routes/auth'))"