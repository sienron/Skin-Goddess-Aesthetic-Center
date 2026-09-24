// routes/users.js
// Admin-only CRUD for the User Management page. Every route here requires
// an authenticated session with role 'admin' (see middleware/auth.js).

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

// Every route below is admin-only.
router.use(requireRole('admin'));

// Roles a badge/filter tab can map to. Keep in sync with the "role" enum
// in the database and with the tab data-role values in UserManagement.html.
const ROLE_BADGE = {
  client: 'CLIENT',
  aesthetician: 'AESTHETICIAN',
  admin: 'ADMIN',
  finance_officer: 'FINANCE OFFICER',
  inventory_officer: 'INVENTORY PROCUREMENT',
  staff: 'STAFF',
};

function toInitials(firstName, lastName) {
  const a = (firstName || '').trim().charAt(0);
  const b = (lastName || '').trim().charAt(0);
  return (a + b).toUpperCase() || '?';
}

function formatUserRow(row) {
  return {
    id: row.user_id,
    fullName: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    initials: toInitials(row.first_name, row.last_name),
    role: row.role,
    roleLabel: ROLE_BADGE[row.role] || row.role,
    sex: row.gender || null,
    email: row.email,
    joined: row.created_at,
    status: row.status,
    dob: row.date_of_birth,
    civilStatus: row.civil_status,
    contact: row.contact_number,
    address: row.home_address,
    allergies: row.allergies ? String(row.allergies).split(',').map((s) => s.trim()).filter(Boolean) : [],
    conditions: row.medical_conditions,
    emailVerified: row.email_verified,
    lastUpdated: row.updated_at,
  };
}

// ============================================
// GET /api/users — list users, with search/filter/pagination
// Query params: search, role (ALL|client|admin|aesthetician|...), status (ALL|active|suspended), page, limit
// ============================================
router.get('/', async (req, res) => {
  const { search = '', role = 'ALL', status = 'ALL', page = '1', limit = '10' } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const values = [];

  if (search.trim()) {
    values.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(LOWER(first_name || ' ' || last_name) LIKE $${values.length} OR LOWER(email) LIKE $${values.length})`);
  }

  if (role !== 'ALL') {
    values.push(role);
    conditions.push(`role = $${values.length}`);
  }

  if (status !== 'ALL') {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await db.query(`SELECT COUNT(*) FROM users ${whereClause}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const listValues = [...values, limitNum, offset];
    const listResult = await db.query(
      `SELECT user_id, first_name, last_name, email, role, status, gender,
              date_of_birth, civil_status, contact_number, home_address,
              allergies, medical_conditions, email_verified, created_at, updated_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    res.status(200).json({
      users: listResult.rows.map(formatUserRow),
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ message: 'Could not load users.' });
  }
});

// ============================================
// GET /api/users/stats — counts for the dashboard stat cards
// ============================================
router.get('/stats', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE role = 'client') AS clients,
        COUNT(*) FILTER (WHERE role != 'client') AS staff,
        COUNT(*) FILTER (WHERE status = 'suspended') AS suspended
      FROM users
    `);

    const row = result.rows[0];
    res.status(200).json({
      total: parseInt(row.total, 10),
      clients: parseInt(row.clients, 10),
      staff: parseInt(row.staff, 10),
      suspended: parseInt(row.suspended, 10),
    });
  } catch (error) {
    console.error('User stats error:', error);
    res.status(500).json({ message: 'Could not load stats.' });
  }
});

// ============================================
// GET /api/users/:id — single user, for the View/Edit modal
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT user_id, first_name, last_name, email, role, status, gender,
              date_of_birth, civil_status, contact_number, home_address,
              allergies, medical_conditions, email_verified, created_at, updated_at
       FROM users WHERE user_id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json(formatUserRow(result.rows[0]));
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Could not load user.' });
  }
});

// ============================================
// POST /api/users — create a new user (admin-created account)
// Generates a temporary password and returns it once in the response
// so the admin can hand it to the new user. There is no OTP step here
// since the admin is vouching for the account directly.
// ============================================
router.post('/', async (req, res) => {
  const { fullName, email, role, status } = req.body;

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const trimmedName = typeof fullName === 'string' ? fullName.trim() : '';

  if (!trimmedName || !normalizedEmail || !role) {
    return res.status(400).json({ message: 'Full name, email, and role are required.' });
  }

  const [firstName, ...rest] = trimmedName.split(' ');
  const lastName = rest.join(' ') || '';

  try {
    const existing = await db.query('SELECT user_id FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'This email is already registered.' });
    }

    const tempPassword = crypto.randomBytes(6).toString('hex'); // e.g. "a1b2c3d4e5f6"
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const insertResult = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, status, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING user_id, first_name, last_name, email, role, status, gender,
                 date_of_birth, civil_status, contact_number, home_address,
                 allergies, medical_conditions, email_verified, created_at, updated_at`,
      [normalizedEmail, passwordHash, firstName, lastName, role, status || 'active']
    );

    res.status(201).json({
      user: formatUserRow(insertResult.rows[0]),
      tempPassword, // shown once — admin should relay this to the new user
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Could not create user.' });
  }
});

// ============================================
// PUT /api/users/:id — edit a user's profile fields (from the modal's Save)
// ============================================
router.put('/:id', async (req, res) => {
  const {
    fullName, email, dob, sex, civilStatus, contact, address,
    skinType, concern, allergies, conditions,
  } = req.body;

  const trimmedName = typeof fullName === 'string' ? fullName.trim() : '';
  const [firstName, ...rest] = trimmedName.split(' ');
  const lastName = rest.join(' ') || '';

  try {
    const result = await db.query(
      `UPDATE users SET
         first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         email = COALESCE($3, email),
         date_of_birth = COALESCE($4, date_of_birth),
         gender = COALESCE($5, gender),
         civil_status = COALESCE($6, civil_status),
         contact_number = COALESCE($7, contact_number),
         home_address = COALESCE($8, home_address),
         allergies = COALESCE($9, allergies),
         medical_conditions = COALESCE($10, medical_conditions),
         updated_at = NOW()
       WHERE user_id = $11
       RETURNING user_id, first_name, last_name, email, role, status, gender,
                 date_of_birth, civil_status, contact_number, home_address,
                 allergies, medical_conditions, email_verified, created_at, updated_at`,
      [
        firstName || null,
        lastName || null,
        email ? email.trim().toLowerCase() : null,
        dob || null,
        sex || null,
        civilStatus || null,
        contact || null,
        address || null,
        Array.isArray(allergies) ? allergies.join(', ') : (allergies || null),
        conditions || null,
        req.params.id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json(formatUserRow(result.rows[0]));
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Could not update user.' });
  }
});

// ============================================
// PATCH /api/users/:id/status — suspend or reactivate a user
// ============================================
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;

  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ message: "Status must be 'active' or 'suspended'." });
  }

  try {
    const result = await db.query(
      `UPDATE users SET status = $1, updated_at = NOW() WHERE user_id = $2
       RETURNING user_id, first_name, last_name, email, role, status, gender,
                 date_of_birth, civil_status, contact_number, home_address,
                 allergies, medical_conditions, email_verified, created_at, updated_at`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json(formatUserRow(result.rows[0]));
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ message: 'Could not update status.' });
  }
});

// ============================================
// DELETE /api/users/:id — permanently remove a user
// ============================================
router.delete('/:id', async (req, res) => {
  // Guard rail: don't let an admin delete their own currently-logged-in account
  if (String(req.session.userId) === String(req.params.id)) {
    return res.status(400).json({ message: 'You cannot delete your own account while logged in.' });
  }

  try {
    const result = await db.query('DELETE FROM users WHERE user_id = $1 RETURNING user_id', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json({ message: 'User deleted.' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Could not delete user.' });
  }
});

module.exports = router;