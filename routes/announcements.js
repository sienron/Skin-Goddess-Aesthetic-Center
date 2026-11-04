const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const ANNOUNCEMENT_TYPES = new Set(['promo', 'deal', 'event', 'announcement']);

function mapAnnouncement(row) {
  return {
    announcement_id: row.announcement_id,
    type: row.type,
    title: row.title,
    message: row.message,
    image_url: row.image_url || '',
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    is_published: row.is_published,
    is_expired: row.is_expired === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function readAnnouncementInput(body) {
  const type = String(body.type || '').trim();
  const title = String(body.title || '').trim();
  const message = String(body.message || '').trim();
  const imageUrl = String(body.imageUrl || '').trim();
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  const isPublished = body.isPublished;

  if (!ANNOUNCEMENT_TYPES.has(type)) throw new Error('Choose a valid announcement type.');
  if (!title || title.length > 160) throw new Error('Enter a title up to 160 characters.');
  if (!message || message.length > 2000) throw new Error('Enter details up to 2000 characters.');
  if (!startsAt) throw new Error('Choose a start date and time.');
  if (!endsAt) throw new Error('Choose an end date and time.');
  const isValidImageUrl = /^\/?(?:images|uploads)\/[a-zA-Z0-9_./% -]+$/.test(imageUrl)
    || /^\/api\/content\/images\/[0-9a-f-]{36}$/i.test(imageUrl);
  if (imageUrl && (!isValidImageUrl || imageUrl.includes('..'))) throw new Error('Choose a valid promo image.');
  if (startsAt && !Number.isFinite(startsAt.getTime())) throw new Error('Choose a valid start date.');
  if (endsAt && !Number.isFinite(endsAt.getTime())) throw new Error('Choose a valid end date.');
  const now = Date.now();
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error('The end date must be after the start date.');
  if (startsAt && startsAt.getTime() <= now) {
    throw new Error('The selected start time has already passed. Choose a later time.');
  }
  if (endsAt && endsAt.getTime() <= now) {
    throw new Error('The selected end time has already passed. Choose a later time.');
  }
  if (typeof isPublished !== 'boolean') throw new Error('Choose whether to publish this announcement.');

  return { type, title, message, imageUrl, startsAt, endsAt, isPublished };
}

function requireClientAccount(req, res, next) {
  if (req.session.role !== 'client') {
    return res.status(403).json({ message: 'You are not authorized to view announcements.' });
  }
  return next();
}

router.get('/public', requireRole('client'), requireClientAccount, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT announcement.announcement_id, announcement.type, announcement.title, announcement.message,
        announcement.image_url, announcement.starts_at, announcement.ends_at, announcement.is_published,
        announcement.created_at, announcement.updated_at,
        EXISTS (
          SELECT 1
          FROM promotional_announcement_reads AS announcement_read
          WHERE announcement_read.announcement_id = announcement.announcement_id
            AND announcement_read.user_id = $1
        ) AS is_read
      FROM promotional_announcements AS announcement
      WHERE announcement.is_published = TRUE
        AND (announcement.starts_at IS NULL OR announcement.starts_at <= NOW())
        AND (announcement.ends_at IS NULL OR announcement.ends_at > NOW())
      ORDER BY announcement.created_at DESC, announcement.announcement_id DESC
      LIMIT 20
    `, [req.session.userId]);
    return res.json({ announcements: result.rows.map((row) => ({
      ...mapAnnouncement(row),
      is_read: row.is_read,
    })) });
  } catch (error) {
    console.error('Could not load promotional announcements:', error.message);
    return res.status(500).json({ message: 'Could not load announcements.' });
  }
});

router.patch('/:id/read', requireRole('client'), requireClientAccount, async (req, res) => {
  const announcementId = Number(req.params.id);
  if (!Number.isSafeInteger(announcementId) || announcementId <= 0) {
    return res.status(400).json({ message: 'Choose a valid announcement.' });
  }

  try {
    const result = await db.query(`
      INSERT INTO promotional_announcement_reads (user_id, announcement_id)
      SELECT $1, announcement_id
      FROM promotional_announcements
      WHERE announcement_id = $2
      ON CONFLICT (user_id, announcement_id) DO NOTHING
      RETURNING announcement_id
    `, [req.session.userId, announcementId]);
    if (result.rows.length === 0) {
      const existing = await db.query(
        'SELECT 1 FROM promotional_announcements WHERE announcement_id = $1',
        [announcementId]
      );
      if (existing.rows.length === 0) return res.status(404).json({ message: 'Announcement not found.' });
    }
    return res.json({ message: 'Announcement marked as read.' });
  } catch (error) {
    console.error('Could not mark promotional announcement as read:', error.message);
    return res.status(500).json({ message: 'Could not mark announcement as read.' });
  }
});

router.get('/admin', requireRole('admin'), async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT announcement_id, type, title, message, image_url, starts_at, ends_at,
        (is_published AND (ends_at IS NULL OR ends_at > NOW())) AS is_published,
        (ends_at IS NOT NULL AND ends_at <= NOW()) AS is_expired,
        created_at, updated_at
      FROM promotional_announcements
      ORDER BY created_at DESC, announcement_id DESC
    `);
    return res.json(result.rows.map(mapAnnouncement));
  } catch (error) {
    console.error('Could not load admin announcements:', error.message);
    return res.status(500).json({ message: 'Could not load announcements.' });
  }
});

router.post('/admin', requireRole('admin'), async (req, res) => {
  let announcement;
  try {
    announcement = readAnnouncementInput(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const result = await db.query(`
      INSERT INTO promotional_announcements (type, title, message, image_url, starts_at, ends_at, is_published)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING announcement_id, type, title, message, image_url, starts_at, ends_at, is_published, created_at, updated_at
    `, [
      announcement.type,
      announcement.title,
      announcement.message,
      announcement.imageUrl,
      announcement.startsAt,
      announcement.endsAt,
      announcement.isPublished,
    ]);
    return res.status(201).json(mapAnnouncement(result.rows[0]));
  } catch (error) {
    console.error('Could not create promotional announcement:', error.message);
    return res.status(500).json({ message: 'Could not create announcement.' });
  }
});

router.put('/admin/:id', requireRole('admin'), async (req, res) => {
  const announcementId = Number(req.params.id);
  if (!Number.isSafeInteger(announcementId) || announcementId < 1) {
    return res.status(400).json({ message: 'Choose a valid announcement.' });
  }

  let announcement;
  try {
    announcement = readAnnouncementInput(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const result = await db.transaction(async (client) => {
      const updated = await client.query(`
        UPDATE promotional_announcements
        SET type = $1, title = $2, message = $3, image_url = $4, starts_at = $5, ends_at = $6,
            is_published = $7, updated_at = NOW()
        WHERE announcement_id = $8
        RETURNING announcement_id, type, title, message, image_url, starts_at, ends_at, is_published, created_at, updated_at
      `, [
        announcement.type,
        announcement.title,
        announcement.message,
        announcement.imageUrl,
        announcement.startsAt,
        announcement.endsAt,
        announcement.isPublished,
        announcementId,
      ]);
      if (updated.rows.length) {
        await client.query(
          'DELETE FROM promotional_announcement_reads WHERE announcement_id = $1',
          [announcementId]
        );
      }
      return updated;
    });
    if (!result.rows.length) return res.status(404).json({ message: 'Announcement not found.' });
    return res.json(mapAnnouncement(result.rows[0]));
  } catch (error) {
    console.error('Could not update promotional announcement:', error.message);
    return res.status(500).json({ message: 'Could not update announcement.' });
  }
});

router.patch('/admin/:id', requireRole('admin'), async (req, res) => {
  const announcementId = Number(req.params.id);
  if (!Number.isSafeInteger(announcementId) || announcementId < 1) {
    return res.status(400).json({ message: 'Choose a valid announcement.' });
  }
  if (typeof req.body?.isPublished !== 'boolean') {
    return res.status(400).json({ message: 'Choose whether to publish this announcement.' });
  }

  try {
    const result = await db.query(`
      UPDATE promotional_announcements
      SET is_published = $1, updated_at = NOW()
      WHERE announcement_id = $2
        AND (
          $1 = FALSE
          OR (
            ends_at > NOW()
            AND ends_at > starts_at
          )
        )
      RETURNING announcement_id
    `, [req.body.isPublished, announcementId]);
    if (!result.rows.length) {
      const existing = await db.query(
        'SELECT announcement_id FROM promotional_announcements WHERE announcement_id = $1',
        [announcementId]
      );
      if (!existing.rows.length) return res.status(404).json({ message: 'Announcement not found.' });
      return res.status(400).json({
        message: 'Update the start and end dates to future times before publishing this announcement.',
      });
    }
    return res.json({ message: 'Announcement status updated.' });
  } catch (error) {
    console.error('Could not update promotional announcement status:', error.message);
    return res.status(500).json({ message: 'Could not update announcement status.' });
  }
});

router.delete('/admin/:id', requireRole('admin'), async (req, res) => {
  const announcementId = Number(req.params.id);
  if (!Number.isSafeInteger(announcementId) || announcementId < 1) {
    return res.status(400).json({ message: 'Choose a valid announcement.' });
  }

  try {
    const result = await db.query(
      'DELETE FROM promotional_announcements WHERE announcement_id = $1 RETURNING announcement_id',
      [announcementId]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Announcement not found.' });
    return res.json({ message: 'Announcement deleted.' });
  } catch (error) {
    console.error('Could not delete promotional announcement:', error.message);
    return res.status(500).json({ message: 'Could not delete announcement.' });
  }
});

module.exports = router;
