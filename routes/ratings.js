const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { notifyUser } = require('../utils/notifications');

const ratingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { message: 'Too many requests. Try again later.' } });

function aggregateResponse(row) {
  const total = Number(row.total) || 0;
  return {
    average: Number(row.average) || 0,
    totalReviews: total,
    breakdown: {
      5: Number(row.s5) || 0,
      4: Number(row.s4) || 0,
      3: Number(row.s3) || 0,
      2: Number(row.s2) || 0,
      1: Number(row.s1) || 0,
    },
  };
}

const AGGREGATE_SQL = `
  SELECT COUNT(*) AS total,
         COALESCE(ROUND(AVG(rating), 1), 0) AS average,
         COUNT(*) FILTER (WHERE rating = 5) AS s5,
         COUNT(*) FILTER (WHERE rating = 4) AS s4,
         COUNT(*) FILTER (WHERE rating = 3) AS s3,
         COUNT(*) FILTER (WHERE rating = 2) AS s2,
         COUNT(*) FILTER (WHERE rating = 1) AS s1
  FROM appointment_ratings WHERE staff_id = $1
`;

// Staff member viewing their own aggregate rating.
router.get('/mine', requireRole('aesthetician', 'nail_tech'), async (req, res) => {
  try {
    const result = await db.query(AGGREGATE_SQL, [req.session.userId]);
    return res.json(aggregateResponse(result.rows[0]));
  } catch (error) {
    console.error('Error fetching staff rating summary:', error.message);
    return res.status(500).json({ message: 'Could not load rating summary.' });
  }
});

// Approved testimonials shown on the public homepage. No login required.
router.get('/public', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.rating_id, r.rating, r.comment, r.created_at,
             s.service_name,
             COALESCE(NULLIF(BTRIM(c.first_name), ''), 'Client') AS client_first_name,
             LEFT(NULLIF(BTRIM(c.last_name), ''), 1) AS client_last_initial
      FROM appointment_ratings r
      JOIN services s ON s.service_id = r.service_id
      JOIN users c ON c.user_id = r.client_id
      WHERE r.is_public = TRUE AND r.comment IS NOT NULL AND BTRIM(r.comment) <> ''
      ORDER BY r.created_at DESC
      LIMIT 7
    `);
    const testimonials = result.rows.map((row) => ({
      ratingId: row.rating_id,
      rating: row.rating,
      comment: row.comment,
      service: row.service_name,
      client: row.client_last_initial ? `${row.client_first_name} ${row.client_last_initial}.` : row.client_first_name,
      createdAt: row.created_at,
    }));
    return res.json(testimonials);
  } catch (error) {
    console.error('Error fetching public testimonials:', error.message);
    return res.status(500).json({ message: 'Could not load testimonials.' });
  }
});

// Admin moderation view with optional filters.
router.get('/admin', requireRole('admin'), async (req, res) => {
  const filters = [];
  const values = [];

  if (req.query.staffId && /^\d+$/.test(req.query.staffId)) {
    values.push(Number(req.query.staffId));
    filters.push(`r.staff_id = $${values.length}`);
  }
  if (req.query.serviceId && /^\d+$/.test(req.query.serviceId)) {
    values.push(Number(req.query.serviceId));
    filters.push(`r.service_id = $${values.length}`);
  }
  if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
    values.push(req.query.date);
    filters.push(`r.created_at::date = $${values.length}`);
  }
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const result = await db.query(`
      SELECT r.rating_id, r.rating, r.comment, r.is_public, r.created_at,
             s.service_name,
             CONCAT_WS(' ', staff.first_name, staff.last_name) AS staff_name,
             CONCAT_WS(' ', client.first_name, client.last_name) AS client_name
      FROM appointment_ratings r
      JOIN services s ON s.service_id = r.service_id
      JOIN users staff ON staff.user_id = r.staff_id
      JOIN users client ON client.user_id = r.client_id
      ${whereClause}
      ORDER BY r.created_at DESC
    `, values);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin ratings:', error.message);
    return res.status(500).json({ message: 'Could not load ratings.' });
  }
});

// Admin approves or hides a rating comment for the homepage.
router.patch('/:id/public', requireRole('admin'), ratingLimiter, async (req, res) => {
  const ratingId = Number(req.params.id);
  if (!Number.isSafeInteger(ratingId) || ratingId <= 0) return res.status(400).json({ message: 'Choose a valid rating.' });
  if (typeof req.body?.isPublic !== 'boolean') return res.status(400).json({ message: 'isPublic must be true or false.' });

  try {
    const result = await db.query(`
      UPDATE appointment_ratings SET is_public = $1 WHERE rating_id = $2
      RETURNING rating_id
    `, [req.body.isPublic, ratingId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Rating not found.' });
    return res.json({ message: req.body.isPublic ? 'Testimonial approved.' : 'Testimonial hidden.' });
  } catch (error) {
    console.error('Error updating rating visibility:', error.message);
    return res.status(500).json({ message: 'Could not update rating.' });
  }
});

module.exports = router;
