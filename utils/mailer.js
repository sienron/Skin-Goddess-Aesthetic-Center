// utils/mailer.js
// Ito yung file na may hawak ng logic para sa pagpapadala ng email —
// gamit natin ito para maipadala ang OTP code sa totoong inbox ng user.
//
// NOTE: Gumagamit tayo ng Brevo's HTTP API (hindi na Nodemailer/SMTP) dahil
// hina-block ni Render ang outbound SMTP ports (25, 465, 587) sa free tier
// nila. Ang Brevo API ay tumatakbo sa HTTPS (port 443), kaya hindi
// naaapektuhan ng block na 'yon.

async function sendOtpEmail(toEmail, otpCode) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        name: 'Skin Goddess Aesthetic Center',
        email: process.env.EMAIL_USER,
      },
      to: [{ email: toEmail }],
      subject: 'Ang verification code mo',
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2 style="color: #C9A84C;">Skin Goddess Aesthetic Center</h2>
          <p>Ang verification code mo ay:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1A1714;">${otpCode}</p>
          <p style="color: #6B6459; font-size: 13px;">Mag-expire ito sa loob ng 5 minuto. Huwag ibahagi sa kahit kanino.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Hindi naipadala ang email: ${errorText}`);
  }
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        name: 'Skin Goddess Aesthetic Center',
        email: process.env.EMAIL_USER,
      },
      to: [{ email: toEmail }],
      subject: 'Reset your password',
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2 style="color: #C9A84C;">Skin Goddess Aesthetic Center</h2>
          <p>A password reset was requested for this account. Click the button below to set a new password:</p>
          <p style="margin: 24px 0;">
            <a href="${resetLink}" style="background: #C9A84C; color: #1A1714; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
              Reset Password
            </a>
          </p>
          <p style="color: #6B6459; font-size: 13px;">This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Hindi naipadala ang email: ${errorText}`);
  }
}

module.exports = { sendOtpEmail, sendPasswordResetEmail };