// routes/users.js
// Admin-only CRUD for the User Management page. Every route here requires
// an authenticated session with role 'admin' (see middleware/auth.js).

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const isValidPassword = require('../utils/password');

// Every route below is admin-only.
router.use(requireRole('admin'));

// Roles a badge/filter tab can map to. Keep in sync with the "role" enum
// in the database and with the tab data-role values in UserManagement.html.
const ROLE_BADGE = {
  client: 'CLIENT',
  aesthetician: 'AESTHETICIAN',
  nail_tech: 'NAIL TECH',
  admin: 'ADMIN',
  finance_officer: 'FINANCE OFFICER',
  inventory_officer: 'INVENTORY PROCUREMENT',
  staff: 'STAFF',
};

// Only one active account per staff role can be assigned appointments (mirrors the
// single-aesthetician business rule, extended to the nail tech role).
const SINGLE_ACTIVE_STAFF_ROLES = ['aesthetician', 'nail_tech'];

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
    if (SINGLE_ACTIVE_STAFF_ROLES.includes(role) && (status || 'active') === 'active') {
      const activeStaffMember = await db.query(
        `SELECT user_id FROM users
         WHERE role = $1 AND status = 'active' AND email_verified = TRUE
         LIMIT 1`,
        [role]
      );
      if (activeStaffMember.rows.length > 0) {
        return res.status(409).json({ message: `Only one active ${ROLE_BADGE[role] || role} can be assigned appointments.` });
      }
    }

    const existing = await db.query('SELECT user_id FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'This email is already registered.' });
    }

    const tempPassword = `${crypto.randomBytes(6).toString('hex')}!`;
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
    skinType, concern, allergies, conditions, password, role,
  } = req.body;

  if (role !== undefined && (typeof role !== 'string' || !Object.hasOwn(ROLE_BADGE, role))) {
    return res.status(400).json({ message: 'Invalid user role.' });
  }

  if (password !== undefined && !isValidPassword(password)) {
    return res.status(400).json({
      message: 'Password must be 8 to 72 characters and include at least one special character.',
    });
  }

  const trimmedName = typeof fullName === 'string' ? fullName.trim() : '';
  const [firstName, ...rest] = trimmedName.split(' ');
  const lastName = rest.join(' ') || '';

  try {
    if (role !== undefined && SINGLE_ACTIVE_STAFF_ROLES.includes(role)) {
      const target = await db.query('SELECT status FROM users WHERE user_id = $1', [req.params.id]);
      if (target.rows.length === 0) {
        return res.status(404).json({ message: 'User not found.' });
      }
      if (target.rows[0].status === 'active') {
        const activeStaffMember = await db.query(
          `SELECT user_id FROM users
           WHERE role = $1 AND status = 'active' AND email_verified = TRUE AND user_id <> $2
           LIMIT 1`,
          [role, req.params.id]
        );
        if (activeStaffMember.rows.length > 0) {
          return res.status(409).json({ message: `Only one active ${ROLE_BADGE[role]} can be assigned appointments.` });
        }
      }
    }

    const passwordHash = password === undefined ? null : await bcrypt.hash(password, 10);
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
         password_hash = COALESCE($11, password_hash),
         role = COALESCE($12, role),
         updated_at = NOW()
       WHERE user_id = $13
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
        passwordHash,
        role || null,
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
    const target = await db.query('SELECT role FROM users WHERE user_id = $1', [req.params.id]);
    if (target.rows.length === 0) return res.status(404).json({ message: 'User not found.' });

    if (status === 'active' && SINGLE_ACTIVE_STAFF_ROLES.includes(target.rows[0].role)) {
      const activeStaffMember = await db.query(
        `SELECT user_id FROM users
         WHERE role = $1 AND status = 'active' AND email_verified = TRUE
           AND user_id <> $2
         LIMIT 1`,
        [target.rows[0].role, req.params.id]
      );
      if (activeStaffMember.rows.length > 0) {
        return res.status(409).json({ message: `Only one active ${ROLE_BADGE[target.rows[0].role] || target.rows[0].role} can be assigned appointments.` });
      }
    }

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
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return res.status(400).json({ message: 'Choose a valid user.' });
  }

  // Guard rail: don't let an admin delete their own currently-logged-in account
  if (String(req.session.userId) === String(userId)) {
    return res.status(400).json({ message: 'You cannot delete your own account while logged in.' });
  }

  try {
    const result = await db.transaction(async (client) => {
      const target = await client.query('SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
      if (target.rows.length === 0) return { outcome: 'missing' };

      const appointments = await client.query(
        `SELECT 1 FROM appointments WHERE user_id = $1 OR aesthetician_id = $1
         UNION ALL
         SELECT 1 FROM treatment_notes WHERE author_id = $1
         UNION ALL
         SELECT 1 FROM appointment_ratings WHERE client_id = $1 OR staff_id = $1
         LIMIT 1`,
        [userId]
      );
      if (appointments.rows.length > 0) return { outcome: 'has-appointments' };

      await client.query('DELETE FROM otp_codes WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM paymongo_checkout_sessions WHERE user_id = $1', [userId]);
      await client.query('UPDATE payments SET recorded_by = NULL WHERE recorded_by = $1', [userId]);
      await client.query(
        `UPDATE expenses
         SET recorded_by = NULLIF(recorded_by, $1), voided_by = NULLIF(voided_by, $1)
         WHERE recorded_by = $1 OR voided_by = $1`,
        [userId]
      );
      await client.query(
        `UPDATE appointments
         SET cancellation_requested_by = NULLIF(cancellation_requested_by, $1),
             cancellation_reviewed_by = NULLIF(cancellation_reviewed_by, $1),
             reschedule_requested_by = NULLIF(reschedule_requested_by, $1),
             reschedule_reviewed_by = NULLIF(reschedule_reviewed_by, $1)
         WHERE cancellation_requested_by = $1 OR cancellation_reviewed_by = $1
            OR reschedule_requested_by = $1 OR reschedule_reviewed_by = $1`,
        [userId]
      );

      await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
      return { outcome: 'deleted' };
    });

    if (result.outcome === 'missing') {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (result.outcome === 'has-appointments') {
      return res.status(409).json({ message: 'This user has appointments and cannot be deleted. Suspend the account instead.' });
    }

    res.status(200).json({ message: 'User deleted.' });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({
        message: 'This account is linked to records that must be retained and cannot be deleted.',
      });
    }
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Could not delete user.' });
  }
});

module.exports = router;