const express = require('express');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');

const router = express.Router();
const subscriptionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many subscription attempts. Please try again later.' },
});
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/', subscriptionLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : '';

  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO newsletter_subscribers (email)
       VALUES ($1)
       ON CONFLICT (LOWER(email)) DO NOTHING
       RETURNING subscriber_id`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        alreadySubscribed: true,
        message: 'This email is already subscribed.',
      });
    }

    return res.status(201).json({
      subscribed: true,
      message: 'Thanks for subscribing!',
    });
  } catch (error) {
    console.error('Newsletter subscription failed:', error);
    return res.status(500).json({
      message: 'We could not subscribe you right now. Please try again.',
    });
  }
});

module.exports = router;
