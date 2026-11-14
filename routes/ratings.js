const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { notifyUser } = require('../utils/notifications');
const { PostgresRateLimitStore } = require('../utils/postgresRateLimitStore');

const ratingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, store: new PostgresRateLimitStore('ratings'), message: { message: 'Too many requests. Try again later.' } });

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

function maskReviewerName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Client';

  return words.map((word, index) => {
    const characters = Array.from(word);
    if (characters.length === 1) return '*';
    if (characters.length === 2) {
      return index === 0 ? `${characters[0]}*` : `*${characters[1]}`;
    }
    if (index === 0) {
      return characters.slice(0, 2).join('') + '*'.repeat(characters.length - 2);
    }
    return '*'.repeat(characters.length - 2) + characters.slice(-2).join('');
  }).join(' ');
}

const AGGREGATE_SQL = `
  SELECT COUNT(*) AS total,
         COALESCE(ROUND(AVG(rating), 1), 0) AS average,
         COUNT(*) FILTER (WHERE rating = 5) AS s5,
         COUNT(*) FILTER (WHERE rating = 4) AS s4,
         COUNT(*) FILTER (WHERE rating = 3) AS s3,
         COUNT(*) FILTER (WHERE rating = 2) AS s2,
         COUNT(*) FILTER (WHERE rating = 1) AS s1
  FROM appointment_ratings r
  LEFT JOIN appointments a ON a.appointment_id = r.appointment_id
  WHERE r.staff_id = $1 AND a.is_demo IS DISTINCT FROM TRUE
`;

function validateManualTestimonial(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Enter the review details.' };
  }

  const reviewerName = typeof input.reviewerName === 'string' ? input.reviewerName.trim() : '';
  if (!reviewerName || reviewerName.length > 120) {
    return { error: 'Reviewer name is required and must be 120 characters or fewer.' };
  }

  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (!comment || comment.length > 2000) {
    return { error: 'Review text is required and must be 2,000 characters or fewer.' };
  }

  let rating = null;
  if (input.rating !== null && input.rating !== undefined && input.rating !== '') {
    rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { error: 'Rating must be a whole number from 1 to 5.' };
    }
  }

  return {
    value: {
      reviewerName,
      comment,
      rating,
    },
  };
}

// Staff member viewing their own aggregate rating.
router.get('/mine', requireRole('aesthetician'), async (req, res) => {
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
      SELECT rating, comment, service, client, source
      FROM (
        SELECT r.rating, r.comment, r.created_at AS sort_date,
               s.service_name AS service,
               CASE
                 WHEN NULLIF(BTRIM(c.last_name), '') IS NULL THEN COALESCE(NULLIF(BTRIM(c.first_name), ''), 'Client')
                 ELSE COALESCE(NULLIF(BTRIM(c.first_name), ''), 'Client') || ' ' || LEFT(BTRIM(c.last_name), 1) || '.'
               END AS client,
               'Website'::text AS source
        FROM appointment_ratings r
        JOIN services s ON s.service_id = r.service_id
        JOIN users c ON c.user_id = r.client_id
        LEFT JOIN appointments a ON a.appointment_id = r.appointment_id
        WHERE r.is_public = TRUE AND r.comment IS NOT NULL AND BTRIM(r.comment) <> ''
          AND a.is_demo IS DISTINCT FROM TRUE
        UNION ALL
        SELECT r.rating, r.comment,
               COALESCE(r.review_date::timestamp AT TIME ZONE 'Asia/Manila', r.created_at) AS sort_date,
               NULL::text AS service,
               r.reviewer_name AS client,
               'Facebook'::text AS source
        FROM manual_testimonials r
        WHERE r.is_public = TRUE
      ) testimonials
      ORDER BY sort_date DESC
      LIMIT 10
    `);
    const testimonials = result.rows.map((row) => ({
      rating: row.rating,
      comment: row.comment,
      service: row.service,
      client: row.source === 'Facebook' ? maskReviewerName(row.client) : row.client,
      source: row.source,
    }));
    return res.json(testimonials);
  } catch (error) {
    console.error('Error fetching public testimonials:', error.message);
    return res.status(500).json({ message: 'Could not load testimonials.' });
  }
});

// Admin moderation view with optional filters.
router.get('/admin', requireRole('admin'), async (req, res) => {
  const filters = ['a.is_demo IS DISTINCT FROM TRUE'];
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
      LEFT JOIN appointments a ON a.appointment_id = r.appointment_id
      ${whereClause}
      ORDER BY r.created_at DESC
    `, values);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin ratings:', error.message);
    return res.status(500).json({ message: 'Could not load ratings.' });
  }
});

router.get('/admin/manual', requireRole('admin'), async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT manual_testimonial_id, reviewer_name, comment, rating, source_url, review_date,
             is_public,
             COALESCE(review_date::timestamp AT TIME ZONE 'Asia/Manila', created_at) AS created_at
      FROM manual_testimonials
      ORDER BY COALESCE(review_date::timestamp AT TIME ZONE 'Asia/Manila', created_at) DESC,
               manual_testimonial_id DESC
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching manual testimonials:', error.message);
    return res.status(500).json({ message: 'Could not load manual testimonials.' });
  }
});

router.post('/manual', requireRole('admin'), ratingLimiter, async (req, res) => {
  const validated = validateManualTestimonial(req.body);
  if (validated.error) return res.status(400).json({ message: validated.error });
  const testimonial = validated.value;

  try {
    const result = await db.query(`
      INSERT INTO manual_testimonials (
        reviewer_name, comment, rating, is_public
      ) VALUES ($1, $2, $3, TRUE)
      RETURNING manual_testimonial_id
    `, [
      testimonial.reviewerName,
      testimonial.comment,
      testimonial.rating,
    ]);
    return res.status(201).json({ manualTestimonialId: result.rows[0].manual_testimonial_id });
  } catch (error) {
    console.error('Error creating manual testimonial:', error.message);
    return res.status(500).json({ message: 'Could not save Facebook testimonial.' });
  }
});

router.put('/manual/:id', requireRole('admin'), ratingLimiter, async (req, res) => {
  const testimonialId = Number(req.params.id);
  if (!Number.isSafeInteger(testimonialId) || testimonialId <= 0) {
    return res.status(400).json({ message: 'Choose a valid testimonial.' });
  }
  const validated = validateManualTestimonial(req.body);
  if (validated.error) return res.status(400).json({ message: validated.error });
  const testimonial = validated.value;

  try {
    const result = await db.query(`
      UPDATE manual_testimonials
      SET reviewer_name = $1, comment = $2, rating = $3,
          updated_at = NOW()
      WHERE manual_testimonial_id = $4
      RETURNING manual_testimonial_id
    `, [
      testimonial.reviewerName,
      testimonial.comment,
      testimonial.rating,
      testimonialId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Testimonial not found.' });
    return res.json({ message: 'Facebook testimonial updated.' });
  } catch (error) {
    console.error('Error updating manual testimonial:', error.message);
    return res.status(500).json({ message: 'Could not update Facebook testimonial.' });
  }
});

router.patch('/manual/:id/public', requireRole('admin'), ratingLimiter, async (req, res) => {
  const testimonialId = Number(req.params.id);
  if (!Number.isSafeInteger(testimonialId) || testimonialId <= 0) {
    return res.status(400).json({ message: 'Choose a valid testimonial.' });
  }
  if (typeof req.body?.isPublic !== 'boolean') {
    return res.status(400).json({ message: 'isPublic must be true or false.' });
  }

  try {
    const result = await db.query(`
      UPDATE manual_testimonials SET is_public = $1, updated_at = NOW()
      WHERE manual_testimonial_id = $2
      RETURNING manual_testimonial_id
    `, [req.body.isPublic, testimonialId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Testimonial not found.' });
    return res.json({ message: req.body.isPublic ? 'Testimonial published.' : 'Testimonial unpublished.' });
  } catch (error) {
    console.error('Error updating manual testimonial visibility:', error.message);
    return res.status(500).json({ message: 'Could not update testimonial visibility.' });
  }
});

router.delete('/manual/:id', requireRole('admin'), ratingLimiter, async (req, res) => {
  const testimonialId = Number(req.params.id);
  if (!Number.isSafeInteger(testimonialId) || testimonialId <= 0) {
    return res.status(400).json({ message: 'Choose a valid testimonial.' });
  }

  try {
    const result = await db.query(`
      DELETE FROM manual_testimonials
      WHERE manual_testimonial_id = $1
      RETURNING manual_testimonial_id
    `, [testimonialId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Testimonial not found.' });
    return res.json({ message: 'Facebook testimonial deleted.' });
  } catch (error) {
    console.error('Error deleting manual testimonial:', error.message);
    return res.status(500).json({ message: 'Could not delete Facebook testimonial.' });
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
