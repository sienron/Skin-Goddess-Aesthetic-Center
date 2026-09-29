const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });

  try {
    const result = await db.query(`
      SELECT notification_id, type, message, is_read, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC, notification_id DESC
      LIMIT 50
    `, [req.session.userId]);
    const unreadResult = await db.query(
      'SELECT COUNT(*)::integer AS unread_count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [req.session.userId]
    );
    return res.json({ notifications: result.rows, unreadCount: unreadResult.rows[0].unread_count });
  } catch (error) {
    console.error('Error fetching notifications:', error.message);
    return res.status(500).json({ message: 'Could not load notifications.' });
  }
});

router.patch('/:id/read', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const notificationId = Number(req.params.id);
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
    return res.status(400).json({ message: 'Choose a valid notification.' });
  }

  try {
    const result = await db.query(`
      UPDATE notifications
      SET is_read = TRUE
      WHERE notification_id = $1 AND user_id = $2
      RETURNING notification_id
    `, [notificationId, req.session.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Notification not found.' });
    return res.json({ message: 'Notification marked as read.' });
  } catch (error) {
    console.error('Error updating notification:', error.message);
    return res.status(500).json({ message: 'Could not update notification.' });
  }
});

module.exports = router;