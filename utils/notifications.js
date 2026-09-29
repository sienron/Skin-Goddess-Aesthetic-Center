const db = require('../db');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function sendNotificationEmail(email, type, message) {
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
      to: [{ email }],
      subject: 'Skin Goddess: notification',
      htmlContent: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1A1714"><h2 style="color:#C9A84C">Skin Goddess Aesthetic Center</h2><p><strong>${escapeHtml(type.replace(/_/g, ' '))}</strong></p><p>${escapeHtml(message)}</p></div>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Brevo notification email failed: ${await response.text()}`);
  }
}

async function notifyUser(userId, type, message, { email = true } = {}) {
  try {
    const result = await db.query(`
      INSERT INTO notifications (user_id, type, message)
      VALUES ($1, $2, $3)
      RETURNING notification_id, user_id, type, message, is_read, created_at
    `, [userId, type, message]);

    if (email) {
      try {
        const recipient = await db.query('SELECT email FROM users WHERE user_id = $1', [userId]);
        if (recipient.rows[0]?.email) {
          await sendNotificationEmail(recipient.rows[0].email, type, message);
        }
      } catch (error) {
        console.error('Could not send notification email:', error.message);
      }
    }

    return result.rows[0];
  } catch (error) {
    console.error('Could not create notification:', error.message);
    return null;
  }
}

async function notifyUsers(userIds, type, message, options) {
  const uniqueIds = [...new Set(userIds.filter((userId) => Number.isInteger(Number(userId))).map(Number))];
  await Promise.all(uniqueIds.map((userId) => notifyUser(userId, type, message, options)));
}

async function notifyRoles(roles, type, message, { excludeUserIds = [], ...options } = {}) {
  try {
    const result = await db.query(`
      SELECT user_id
      FROM users
      WHERE role::text = ANY($1::text[])
        AND status = 'active'
        AND NOT (user_id = ANY($2::integer[]))
    `, [roles, excludeUserIds]);
    await notifyUsers(result.rows.map((row) => row.user_id), type, message, options);
  } catch (error) {
    console.error('Could not find notification recipients:', error.message);
  }
}

module.exports = { notifyUser, notifyUsers, notifyRoles };