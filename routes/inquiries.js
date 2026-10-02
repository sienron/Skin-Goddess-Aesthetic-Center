const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { sendInquiryReply, sendInquiryNotification } = require('../utils/mailer');

const router = express.Router();
const INQUIRY_TYPES = new Set(['booking', 'services', 'feedback', 'other']);

router.post('/', async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone = '',
    subject,
    message,
  } = req.body || {};

  const inquiry = {
    firstName: typeof firstName === 'string' ? firstName.trim() : '',
    lastName: typeof lastName === 'string' ? lastName.trim() : '',
    email: typeof email === 'string' ? email.trim().toLowerCase() : '',
    phone: typeof phone === 'string' ? phone.trim() : '',
    subject: typeof subject === 'string' ? subject : '',
    message: typeof message === 'string' ? message.trim() : '',
  };

  if (!inquiry.firstName || !inquiry.lastName || !inquiry.email || !inquiry.subject || !inquiry.message) {
    return res.status(400).json({ message: 'Please complete all required fields.' });
  }
  if (inquiry.firstName.length > 100 || inquiry.lastName.length > 100 || inquiry.email.length > 254 || inquiry.phone.length > 50 || inquiry.message.length > 5000) {
    return res.status(400).json({ message: 'One or more fields exceed the allowed length.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }
  if (!INQUIRY_TYPES.has(inquiry.subject)) {
    return res.status(400).json({ message: 'Please select a valid inquiry type.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO inquiries (first_name, last_name, email, phone, inquiry_type, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING inquiry_id`,
      [inquiry.firstName, inquiry.lastName, inquiry.email, inquiry.phone || null, inquiry.subject, inquiry.message]
    );

    try {
      await sendInquiryNotification(inquiry);
    } catch (error) {
      console.error('Inquiry saved, but notification email failed:', error.message);
    }

    res.status(201).json({ message: 'Your inquiry has been sent.', inquiryId: result.rows[0].inquiry_id });
  } catch (error) {
    console.error('Save inquiry error:', error);
    res.status(500).json({ message: 'We could not send your inquiry right now. Please try again.' });
  }
});

router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT inquiry_id, first_name, last_name, email, phone, inquiry_type,
              message, admin_reply, replied_at, created_at
       FROM inquiries
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List inquiries error:', error);
    res.status(500).json({ message: 'Could not load inquiries.' });
  }
});

router.post('/:id/reply', requireRole('admin'), async (req, res) => {
  const inquiryId = Number.parseInt(req.params.id, 10);
  const reply = typeof req.body?.reply === 'string' ? req.body.reply.trim() : '';
  if (!Number.isInteger(inquiryId) || inquiryId < 1) {
    return res.status(400).json({ message: 'Invalid inquiry.' });
  }
  if (!reply || reply.length > 5000) {
    return res.status(400).json({ message: 'Reply must be between 1 and 5000 characters.' });
  }

  try {
    const result = await db.query(
      `SELECT inquiry_id, first_name, last_name, email, inquiry_type
       FROM inquiries WHERE inquiry_id = $1`,
      [inquiryId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inquiry not found.' });
    }

    const inquiry = result.rows[0];
    await sendInquiryReply(inquiry.email, inquiry.first_name, reply);
    await db.query(
      `UPDATE inquiries SET admin_reply = $1, replied_at = NOW() WHERE inquiry_id = $2`,
      [reply, inquiryId]
    );
    res.json({ message: 'Reply sent to the customer.' });
  } catch (error) {
    console.error('Reply to inquiry error:', error);
    res.status(502).json({ message: 'The reply could not be emailed. Please check email configuration and try again.' });
  }
});

module.exports = router;