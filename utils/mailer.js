// utils/mailer.js
// Ito yung file na may hawak ng logic para sa pagpapadala ng email —
// gamit natin ito para maipadala ang OTP code sa totoong inbox ng user.
//
// NOTE: Gumagamit tayo ng Brevo's HTTP API (hindi na Nodemailer/SMTP) dahil
// hina-block ni Render ang outbound SMTP ports (25, 465, 587) sa free tier
// nila. Ang Brevo API ay tumatakbo sa HTTPS (port 443), kaya hindi
// naaapektuhan ng block na 'yon.
const { assertDemoCustomerExternalOperationAllowed } = require('./demoMode');

async function sendOtpEmail(toEmail, otpCode) {
  assertDemoCustomerExternalOperationAllowed('Brevo email delivery', toEmail);
  const email = buildBrandedEmail({
    preheader: 'Your secure email verification code is ready.',
    title: 'Verify your email',
    intro: 'Use this one-time code to verify your email address.',
    code: otpCode,
    footerNote: 'This code expires in 5 minutes. Never share it with anyone. If you did not request this code, you can ignore this email.',
  });
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
      subject: 'Your Skin Goddess verification code',
      htmlContent: email.html,
      textContent: email.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`The email was not sent: ${errorText}`);
  }
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  assertDemoCustomerExternalOperationAllowed('Brevo email delivery', toEmail);
  const email = buildBrandedEmail({
    preheader: 'Use the secure link to reset your account password.',
    title: 'Reset your password',
    intro: 'A password reset was requested for your Skin Goddess account.',
    paragraphs: ['Use the secure button below to choose a new password.'],
    action: { label: 'Reset password', url: resetLink },
    footerNote: 'This link expires in 30 minutes. If you did not request a password reset, you can safely ignore this email.',
  });
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
      subject: 'Reset your Skin Goddess password',
      htmlContent: email.html,
      textContent: email.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`The email was not sent: ${errorText}`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatEmailText(value) {
  return String(value).split(/\r?\n/).map((line) => escapeHtml(line)).join('<br>');
}

function buildBrandedEmail({ preheader, title, intro, paragraphs = [], details = [], code, action, footerNote }) {
  const safeTitle = escapeHtml(title);
  const detailRows = details.map(({ label, value }) => `
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid #eee8dd;color:#6b6459;font-size:14px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #eee8dd;color:#1a1714;font-size:14px;font-weight:600;text-align:right;vertical-align:top;">${formatEmailText(value)}</td>
    </tr>
  `).join('');
  const actionMarkup = action ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;">
      <tr>
        <td align="center" bgcolor="#c9a84c" style="border-radius:5px;">
          <a href="${escapeHtml(action.url)}" style="display:inline-block;padding:14px 24px;color:#1a1714;font-size:14px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(action.label)}</a>
        </td>
      </tr>
    </table>
    <p style="margin:14px 0 0;color:#6b6459;font-size:12px;line-height:18px;word-break:break-all;">If the button doesn’t work, copy this link:<br>${escapeHtml(action.url)}</p>
  ` : '';
  const safePreheader = escapeHtml(preheader);
  const safeIntro = intro ? `<p style="margin:0 0 18px;color:#39332c;font-size:15px;line-height:24px;">${formatEmailText(intro)}</p>` : '';
  const paragraphMarkup = paragraphs.map((paragraph) => `
    <p style="margin:0 0 16px;color:#39332c;font-size:15px;line-height:24px;">${formatEmailText(paragraph)}</p>
  `).join('');
  const detailMarkup = detailRows ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background:#fbf9f5;border:1px solid #eee8dd;border-radius:6px;border-collapse:separate;">
      ${detailRows}
    </table>
  ` : '';
  const codeMarkup = code ? `
    <p style="margin:24px 0;padding:16px 12px;border:1px solid #eee4cf;border-radius:6px;background:#fbf7ed;color:#1a1714;font-size:30px;font-weight:700;letter-spacing:8px;line-height:38px;text-align:center;">${escapeHtml(code)}</p>
  ` : '';
  const safeFooterNote = footerNote
    ? `<p style="margin:0 0 14px;color:#6b6459;font-size:12px;line-height:19px;">${formatEmailText(footerNote)}</p>`
    : '';
  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title></head>
  <body style="margin:0;padding:0;background:#f5f2ec;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;">
      <tr><td align="center" style="padding:32px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #eee8dd;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#1a1714;border-bottom:4px solid #c9a84c;">
            <p style="margin:0;color:#f4d887;font-size:11px;font-weight:700;letter-spacing:2px;line-height:18px;text-transform:uppercase;">Skin Goddess</p>
            <p style="margin:2px 0 0;color:#ffffff;font-size:14px;line-height:20px;">Aesthetic Center</p>
          </td></tr>
          <tr><td style="padding:32px;">
            <h1 style="margin:0 0 20px;color:#1a1714;font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:600;line-height:32px;">${safeTitle}</h1>
            ${safeIntro}${paragraphMarkup}${detailMarkup}${codeMarkup}${actionMarkup}
            ${safeFooterNote}
          </td></tr>
          <tr><td style="padding:22px 32px;background:#fbf9f5;border-top:1px solid #eee8dd;">
            <p style="margin:0 0 6px;color:#39332c;font-size:12px;font-weight:700;line-height:18px;">Skin Goddess Aesthetic Center</p>
            <p style="margin:0;color:#6b6459;font-size:12px;line-height:19px;">2nd floor, KW Plaza Building, Pasong Buaya 2, Imus, Cavite 4103<br>
              <a href="tel:+639456119436" style="color:#73551b;text-decoration:none;">+63 945 611 9436</a>
              &nbsp;·&nbsp;
              <a href="mailto:skingoddess456@gmail.com" style="color:#73551b;text-decoration:none;">skingoddess456@gmail.com</a>
            </p>
            <p style="margin:12px 0 0;color:#8a8378;font-size:11px;line-height:17px;">This is an automated email. Please contact the clinic if you need assistance.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  const textParts = [title, '='.repeat(String(title).length), intro, ...paragraphs];
  if (details.length) textParts.push(details.map(({ label, value }) => `${label}: ${value}`).join('\n'));
  if (code) textParts.push(`Verification code: ${code}`);
  if (action) textParts.push(`${action.label}: ${action.url}`);
  if (footerNote) textParts.push(footerNote);
  textParts.push(
    'Skin Goddess Aesthetic Center',
    '2nd floor, KW Plaza Building, Pasong Buaya 2, Imus, Cavite 4103',
    '+63 945 611 9436',
    'skingoddess456@gmail.com',
  );
  return { html, text: textParts.filter(Boolean).join('\n\n') };
}

function cleanSubject(value) {
  return String(value).replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function sendAppointmentReminderEmail(appointment, reminderHours) {
  if (appointment.is_demo === true) {
    throw new Error('Brevo email delivery is disabled for synthetic demo appointments.');
  }
  assertDemoCustomerExternalOperationAllowed('Brevo email delivery', appointment.email);
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_USER) {
    throw new Error('BREVO_API_KEY and EMAIL_USER must be configured to send appointment reminders.');
  }

  const dateParts = String(appointment.appointment_date).split('-').map(Number);
  const timeParts = String(appointment.appointment_time).split(':').map(Number);
  const appointmentDate = new Date(Date.UTC(
    dateParts[0],
    dateParts[1] - 1,
    dateParts[2],
    timeParts[0] - 8,
    timeParts[1],
  ));
  const dateLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'long',
  }).format(appointmentDate);
  const timeLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(appointmentDate);
  const leadLabel = reminderHours === 24 ? 'within the next 24 hours' : 'in about three hours';
  const email = buildBrandedEmail({
    preheader: `Appointment reminder: ${appointment.service_name} ${leadLabel}.`,
    title: 'Your appointment is coming up',
    intro: `Hello ${appointment.first_name || 'there'},`,
    paragraphs: [`This is a friendly reminder that your ${appointment.service_name} appointment is ${leadLabel}.`, 'We look forward to welcoming you.'],
    details: [
      { label: 'Service', value: appointment.service_name },
      { label: 'Date', value: dateLabel },
      { label: 'Time', value: `${timeLabel} (Philippine time)` },
    ],
  });
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
      to: [{ email: appointment.email }],
      subject: cleanSubject(`Appointment reminder: ${appointment.service_name}`),
      htmlContent: email.html,
      textContent: email.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`The appointment reminder email was not sent: ${errorText}`);
  }
}

async function sendInquiryReply(toEmail, firstName, reply) {
  assertDemoCustomerExternalOperationAllowed('Brevo email delivery', toEmail);
  const email = buildBrandedEmail({
    preheader: 'The clinic has replied to your inquiry.',
    title: 'A reply to your inquiry',
    intro: `Hello ${firstName || 'there'},`,
    paragraphs: [reply, 'Thank you for contacting Skin Goddess Aesthetic Center.'],
  });
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
      subject: 'Skin Goddess has replied to your inquiry',
      htmlContent: email.html,
      textContent: email.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`The inquiry reply was not sent: ${errorText}`);
  }
}

async function sendInquiryNotification(inquiry) {
  assertDemoCustomerExternalOperationAllowed('Brevo email delivery', inquiry.email);
  const recipient = process.env.INQUIRY_NOTIFICATION_EMAIL || process.env.EMAIL_USER;
  if (!recipient) {
    throw new Error('INQUIRY_NOTIFICATION_EMAIL or EMAIL_USER must be configured.');
  }

  const fullName = `${inquiry.firstName} ${inquiry.lastName}`.trim();
  const email = buildBrandedEmail({
    preheader: `New customer inquiry: ${inquiry.subject}.`,
    title: 'New customer inquiry',
    intro: `A customer has sent a message through the Skin Goddess website.`,
    details: [
      { label: 'From', value: fullName },
      { label: 'Email', value: inquiry.email },
      { label: 'Phone', value: inquiry.phone || 'Not provided' },
      { label: 'Inquiry type', value: inquiry.subject },
    ],
    paragraphs: [`Message:\n${inquiry.message}`],
  });
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
      to: [{ email: recipient }],
      replyTo: { email: inquiry.email, name: cleanSubject(fullName) },
      subject: cleanSubject(`New ${inquiry.subject} inquiry from ${fullName}`),
      htmlContent: email.html,
      textContent: email.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`The inquiry notification was not sent: ${errorText}`);
  }
}

async function sendNotificationEmail(toEmail, type, message, { idempotencyKey } = {}) {
  assertDemoCustomerExternalOperationAllowed('Brevo email delivery', toEmail);
  const title = cleanSubject(type.replace(/_/g, ' '))
    .replace(/\b\w/g, (character) => character.toUpperCase());
  const email = buildBrandedEmail({
    preheader: 'You have a new update from Skin Goddess Aesthetic Center.',
    title,
    intro: 'Here is an update from the clinic:',
    paragraphs: [message],
  });
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    ...(idempotencyKey ? { signal: AbortSignal.timeout(15000) } : {}),
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      ...(idempotencyKey ? { headers: { idempotencyKey } } : {}),
      sender: {
        name: 'Skin Goddess Aesthetic Center',
        email: process.env.EMAIL_USER,
      },
      to: [{ email: toEmail }],
      subject: cleanSubject(`Skin Goddess: ${title}`),
      htmlContent: email.html,
      textContent: email.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (idempotencyKey && detail.includes('duplicate_parameter')) return;
    throw new Error(`Brevo notification email failed: ${detail}`);
  }
}

module.exports = {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendAppointmentReminderEmail,
  sendInquiryReply,
  sendInquiryNotification,
  sendNotificationEmail,
};
