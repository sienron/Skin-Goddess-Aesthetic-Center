const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function mapHomepageContent(row) {
  return {
    key: row.content_key,
    label: row.label,
    title: row.title,
    body: row.body,
    payload: row.payload || {},
    isPublished: row.is_published,
  };
}

function mapTeamMember(row) {
  return {
    id: row.team_member_id,
    name: row.name,
    role: row.role,
    specialty: row.specialty || '',
    experience: row.experience || '',
    photoUrl: row.photo_url,
    isPublished: row.is_published,
    sortOrder: row.sort_order,
  };
}

function readTeamInput(body) {
  const name = String(body.name || '').trim();
  const role = String(body.role || '').trim();
  const specialty = String(body.specialty || '').trim();
  const experience = String(body.experience || '').trim();
  const photoUrl = String(body.photoUrl || 'images/SkinGoddessReceptionImg.jpg').trim();
  const sortOrder = Number(body.sortOrder || 0);

  if (!name || name.length > 160) throw new Error('Enter a team member name up to 160 characters.');
  if (!role || role.length > 160) throw new Error('Enter a role up to 160 characters.');
  if (specialty.length > 500 || experience.length > 500) throw new Error('Specialty and experience must be 500 characters or fewer.');
  if (!/^images\/[a-zA-Z0-9_./-]+$/.test(photoUrl) || photoUrl.includes('..')) throw new Error('Choose an image from the images folder.');
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) throw new Error('Enter a valid display order.');

  return { name, role, specialty, experience, photoUrl, sortOrder };
}

router.get('/public/homepage', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT content_key, label, title, body, payload, is_published
      FROM homepage_content WHERE is_published = TRUE ORDER BY display_order, content_key
    `);
    return res.json(result.rows.map(mapHomepageContent));
  } catch (error) {
    console.error('Could not load homepage content:', error.message);
    return res.status(500).json({ message: 'Could not load homepage content.' });
  }
});

router.get('/public/team', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT team_member_id, name, role, specialty, experience, photo_url, is_published, sort_order
      FROM website_team_members WHERE is_published = TRUE ORDER BY sort_order, team_member_id
    `);
    return res.json(result.rows.map(mapTeamMember));
  } catch (error) {
    console.error('Could not load public team:', error.message);
    return res.status(500).json({ message: 'Could not load team members.' });
  }
});

router.get('/admin/homepage', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT content_key, label, title, body, payload, is_published
      FROM homepage_content ORDER BY display_order, content_key
    `);
    return res.json(result.rows.map(mapHomepageContent));
  } catch (error) {
    console.error('Could not load homepage content:', error.message);
    return res.status(500).json({ message: 'Could not load homepage content.' });
  }
});

router.put('/admin/homepage/:key', requireRole('admin'), async (req, res) => {
  const key = String(req.params.key || '').trim();
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const payload = req.body?.payload;
  const isPublished = req.body?.isPublished;

  if (!/^[a-z0-9_]{1,80}$/.test(key)) return res.status(400).json({ message: 'Choose a valid content block.' });
  if (!title || title.length > 500) return res.status(400).json({ message: 'Enter a title up to 500 characters.' });
  if (body.length > 2000) return res.status(400).json({ message: 'Body must be 2000 characters or fewer.' });
  if (typeof isPublished !== 'boolean') return res.status(400).json({ message: 'Choose whether this content is published.' });
  if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
    return res.status(400).json({ message: 'Content data must be an object.' });
  }

  try {
    const result = await db.query(`
      UPDATE homepage_content
      SET title = $1, body = $2, payload = COALESCE($3::jsonb, payload), is_published = $4, updated_at = NOW()
      WHERE content_key = $5
      RETURNING content_key, label, title, body, payload, is_published
    `, [title, body, payload === undefined ? null : JSON.stringify(payload), isPublished, key]);
    if (!result.rows.length) return res.status(404).json({ message: 'Content block not found.' });
    return res.json(mapHomepageContent(result.rows[0]));
  } catch (error) {
    console.error('Could not update homepage content:', error.message);
    return res.status(500).json({ message: 'Could not update homepage content.' });
  }
});

router.get('/admin/team', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT team_member_id, name, role, specialty, experience, photo_url, is_published, sort_order
      FROM website_team_members ORDER BY sort_order, team_member_id
    `);
    return res.json(result.rows.map(mapTeamMember));
  } catch (error) {
    console.error('Could not load team members:', error.message);
    return res.status(500).json({ message: 'Could not load team members.' });
  }
});

router.post('/admin/team', requireRole('admin'), async (req, res) => {
  let member;
  try {
    member = readTeamInput(req.body || {});
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const result = await db.query(`
      INSERT INTO website_team_members (name, role, specialty, experience, photo_url, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING team_member_id, name, role, specialty, experience, photo_url, is_published, sort_order
    `, [member.name, member.role, member.specialty, member.experience, member.photoUrl, member.sortOrder]);
    return res.status(201).json(mapTeamMember(result.rows[0]));
  } catch (error) {
    console.error('Could not create team member:', error.message);
    return res.status(500).json({ message: 'Could not create team member.' });
  }
});

router.put('/admin/team/:id', requireRole('admin'), async (req, res) => {
  const memberId = Number(req.params.id);
  if (!Number.isSafeInteger(memberId) || memberId < 1) return res.status(400).json({ message: 'Choose a valid team member.' });

  let member;
  try {
    member = readTeamInput(req.body || {});
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const result = await db.query(`
      UPDATE website_team_members
      SET name = $1, role = $2, specialty = $3, experience = $4, photo_url = $5,
          sort_order = $6, updated_at = NOW()
      WHERE team_member_id = $7
      RETURNING team_member_id, name, role, specialty, experience, photo_url, is_published, sort_order
    `, [member.name, member.role, member.specialty, member.experience, member.photoUrl, member.sortOrder, memberId]);
    if (!result.rows.length) return res.status(404).json({ message: 'Team member not found.' });
    return res.json(mapTeamMember(result.rows[0]));
  } catch (error) {
    console.error('Could not update team member:', error.message);
    return res.status(500).json({ message: 'Could not update team member.' });
  }
});

router.patch('/admin/team/:id/status', requireRole('admin'), async (req, res) => {
  const memberId = Number(req.params.id);
  if (!Number.isSafeInteger(memberId) || memberId < 1) return res.status(400).json({ message: 'Choose a valid team member.' });
  if (typeof req.body?.isPublished !== 'boolean') return res.status(400).json({ message: 'Choose whether the team member is published.' });

  try {
    const result = await db.query(`
      UPDATE website_team_members SET is_published = $1, updated_at = NOW()
      WHERE team_member_id = $2 RETURNING team_member_id, is_published
    `, [req.body.isPublished, memberId]);
    if (!result.rows.length) return res.status(404).json({ message: 'Team member not found.' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Could not update team member status:', error.message);
    return res.status(500).json({ message: 'Could not update team member status.' });
  }
});

module.exports = router;