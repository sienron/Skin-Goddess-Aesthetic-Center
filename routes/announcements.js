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
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    is_published: row.is_published,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function readAnnouncementInput(body) {
  const type = String(body.type || '').trim();
  const title = String(body.title || '').trim();
  const message = String(body.message || '').trim();
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  const isPublished = body.isPublished;

  if (!ANNOUNCEMENT_TYPES.has(type)) throw new Error('Choose a valid announcement type.');
  if (!title || title.length > 160) throw new Error('Enter a title up to 160 characters.');
  if (!message || message.length > 2000) throw new Error('Enter details up to 2000 characters.');
  if (startsAt && !Number.isFinite(startsAt.getTime())) throw new Error('Choose a valid start date.');
  if (endsAt && !Number.isFinite(endsAt.getTime())) throw new Error('Choose a valid end date.');
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error('The end date must be after the start date.');
  if (typeof isPublished !== 'boolean') throw new Error('Choose whether to publish this announcement.');

  return { type, title, message, startsAt, endsAt, isPublished };
}

router.get('/public', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT announcement_id, type, title, message, starts_at, ends_at, is_published, created_at, updated_at
      FROM promotional_announcements
      WHERE is_published = TRUE
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY created_at DESC, announcement_id DESC
      LIMIT 20
    `);
    return res.json({ announcements: result.rows.map(mapAnnouncement) });
  } catch (error) {
    console.error('Could not load promotional announcements:', error.message);
    return res.status(500).json({ message: 'Could not load announcements.' });
  }
});

router.get('/admin', requireRole('admin'), async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT announcement_id, type, title, message, starts_at, ends_at, is_published, created_at, updated_at
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
      INSERT INTO promotional_announcements (type, title, message, starts_at, ends_at, is_published)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING announcement_id, type, title, message, starts_at, ends_at, is_published, created_at, updated_at
    `, [
      announcement.type,
      announcement.title,
      announcement.message,
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
    const result = await db.query(`
      UPDATE promotional_announcements
      SET type = $1, title = $2, message = $3, starts_at = $4, ends_at = $5,
          is_published = $6, updated_at = NOW()
      WHERE announcement_id = $7
      RETURNING announcement_id, type, title, message, starts_at, ends_at, is_published, created_at, updated_at
    `, [
      announcement.type,
      announcement.title,
      announcement.message,
      announcement.startsAt,
      announcement.endsAt,
      announcement.isPublished,
      announcementId,
    ]);
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
      RETURNING announcement_id
    `, [req.body.isPublished, announcementId]);
    if (!result.rows.length) return res.status(404).json({ message: 'Announcement not found.' });
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
