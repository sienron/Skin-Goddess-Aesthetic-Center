const db = require('../db');
const { sendNotificationEmail } = require('./mailer');

async function notifyUserWithDelivery(userId, type, message, { email = true } = {}) {
  let notification;
  try {
    const result = await db.query(`
      INSERT INTO notifications (user_id, type, message)
      VALUES ($1, $2, $3)
      RETURNING notification_id, user_id, type, message, is_read, created_at
    `, [userId, type, message]);
    notification = result.rows[0];
  } catch (error) {
    console.error('Could not create notification:', error.message);
    return { notification: null, emailStatus: email ? 'failed' : 'not_requested' };
  }

  let emailStatus = email ? 'failed' : 'not_requested';
  if (email) {
    try {
      const recipient = await db.query('SELECT email FROM users WHERE user_id = $1', [userId]);
      if (recipient.rows[0]?.email) {
        await sendNotificationEmail(recipient.rows[0].email, type, message);
        emailStatus = 'sent';
      } else {
        emailStatus = 'not_requested';
      }
    } catch (error) {
      console.error('Could not send notification email:', error.message);
    }
  }

  return { notification, emailStatus };
}

async function notifyUser(userId, type, message, options) {
  const result = await notifyUserWithDelivery(userId, type, message, options);
  return result.notification;
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

module.exports = { notifyUser, notifyUserWithDelivery, notifyUsers, notifyRoles };