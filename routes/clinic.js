const express = require('express');
const { createHash } = require('node:crypto');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { manilaNow } = require('../utils/slots');
const { validDate, normalizeHours, loadSchedule, fitsSchedule } = require('../utils/clinicSchedule');
const { queueClinicEvent, processClinicNotifications } = require('../utils/clinicNotifications');
const router = express.Router();
router.use(requireRole('admin'));
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const wrap = (handler) => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    if (!error.statusCode) console.error('Clinic management error:', error);
    res.status(error.statusCode || (error.code === '23505' ? 409 : 500)).json({ message: error.statusCode ? error.message : error.code === '23505' ? 'A selected date is already closed. Refresh and review again.' : 'Could not save clinic changes. Please try again.' });
  }
};
const id = (value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fail('Choose a valid record.');
function closureInput(body) {
  const dates = [...new Set(Array.isArray(body.dates) ? body.dates : [])].sort();
  if (!dates.length || dates.length > 90 || dates.some((date) => !validDate(date) || date < manilaNow().dateStr)) fail('Select between 1 and 90 valid dates, today or later (Asia/Manila).');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 1000) fail('Enter a closure reason of up to 1,000 characters.');
  return { dates, reason };
}
async function version(client) { return (await client.query('SELECT version FROM clinic_settings WHERE singleton=TRUE')).rows[0].version; }
async function lock(client) { await client.query('SELECT pg_advisory_xact_lock(5032026,1)'); }
async function bump(client) { await client.query('UPDATE clinic_settings SET version=version+1 WHERE singleton=TRUE'); }
async function affected(client, dates = null) {
  return (await client.query(`SELECT a.appointment_id,a.user_id,a.aesthetician_id,
    a.appointment_date::text AS appointment_date,a.appointment_time::text AS appointment_time,
    GREATEST(a.appointment_end_time,COALESCE(a.adjusted_expected_end_time,a.appointment_end_time))::text AS appointment_end_time,
    a.appointment_status,a.updated_at::text,
    COALESCE(NULLIF(CONCAT_WS(' ',a.customer_first_name,a.customer_last_name),''),NULLIF(CONCAT_WS(' ',u.first_name,u.last_name),''),a.walk_in_name,'Client') AS client,
    s.service_name
    FROM appointments a LEFT JOIN users u ON u.user_id=a.user_id JOIN services s ON s.service_id=a.service_id
    WHERE a.is_demo=FALSE AND a.appointment_status IN ('pending','confirmed','in_progress')
      AND a.appointment_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
      AND ($1::date[] IS NULL OR a.appointment_date=ANY($1::date[]))
    ORDER BY a.appointment_date,a.appointment_time,a.appointment_id`, [dates])).rows;
}
function token(kind, input, currentVersion, appointments) {
  return createHash('sha256').update(JSON.stringify({ kind, input, version: currentVersion,
    appointments: appointments.map(({ appointment_id, appointment_date, appointment_time, appointment_end_time, appointment_status, updated_at }) =>
      ({ appointment_id, appointment_date, appointment_time, appointment_end_time, appointment_status, updated_at })) })).digest('hex');
}
async function review(client, kind, input, excludeId = null) {
  const currentVersion = await version(client);
  let appointments;
  if (kind === 'hours') {
    appointments = (await affected(client)).filter((a) => !fitsSchedule({ days: input, closures: [] }, a.appointment_date, a.appointment_time, a.appointment_end_time));
  } else {
    const existing = await client.query('SELECT closure_id FROM clinic_closures WHERE closure_date=ANY($1::date[]) AND reopened_at IS NULL AND ($2::bigint IS NULL OR closure_id<>$2)', [input.dates, excludeId]);
    if (existing.rows.length) fail('A selected date is already closed. Choose another date.', 409);
    appointments = await affected(client, input.dates);
  }
  return { affectedAppointments: appointments, reviewToken: token(kind, { input, excludeId }, currentVersion, appointments), version: currentVersion };
}
async function flag(client, appointments, source, reason) {
  for (const appointment of appointments) {
    await client.query(`INSERT INTO clinic_appointment_impacts(closure_id,change_id,appointment_id,original_date,original_time)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [source.closureId || null, source.changeId || null, appointment.appointment_id, appointment.appointment_date, appointment.appointment_time]);
    await queueClinicEvent(client, { key: `${source.closureId ? 'closure' : 'hours'}:${source.closureId || source.changeId}:affected:${appointment.appointment_id}`,
      type: 'clinic_appointment_pending_resolution', message: `Appointment ${appointment.appointment_id}: ${appointment.service_name} on ${appointment.appointment_date} at ${appointment.appointment_time.slice(0,5)} (Asia/Manila) is Pending Resolution. ${reason} Clinic staff will coordinate rescheduling or cancellation. Your appointment has not been cancelled.`,
      closureId: source.closureId, appointmentId: appointment.appointment_id, userIds: [appointment.user_id, appointment.aesthetician_id], roles: ['admin','staff'] });
  }
}
router.get('/', wrap(async (_req, res) => {
  const schedule = await loadSchedule(db);
  const closures = await db.query(`SELECT c.closure_id,c.closure_date::text,c.reason,c.version,c.created_at,c.reopened_at,
    CASE WHEN c.reopened_at IS NOT NULL THEN 'reopened' WHEN c.closure_date < (NOW() AT TIME ZONE 'Asia/Manila')::date THEN 'past'
      WHEN c.closure_date = (NOW() AT TIME ZONE 'Asia/Manila')::date THEN 'closed_today' ELSE 'scheduled' END AS status,
    COUNT(i.impact_id)::integer AS affected_count,COUNT(*) FILTER(WHERE i.resolution='pending')::integer AS pending_count,
    COUNT(*) FILTER(WHERE i.resolution='rescheduled')::integer AS rescheduled_count,
    COUNT(*) FILTER(WHERE i.resolution='cancelled')::integer AS cancelled_count
    FROM clinic_closures c LEFT JOIN clinic_appointment_impacts i USING(closure_id)
    GROUP BY c.closure_id ORDER BY c.closure_date DESC,c.closure_id DESC`);
  const pending = await db.query(`SELECT i.impact_id,i.closure_id,i.change_id,i.original_date::text,i.resolution,a.appointment_id,
    a.appointment_date::text,a.appointment_time::text,s.service_name,
    COALESCE(NULLIF(CONCAT_WS(' ',a.customer_first_name,a.customer_last_name),''),a.walk_in_name,'Client') AS client
    FROM clinic_appointment_impacts i JOIN appointments a USING(appointment_id) JOIN services s USING(service_id)
    WHERE i.resolution='pending' ORDER BY a.appointment_date,a.appointment_time`);
  res.json({ ...schedule, version: await version(db), closures: closures.rows,
    pendingAppointments: [...new Map(pending.rows.map(appointment => [appointment.appointment_id,appointment])).values()], timezone: 'Asia/Manila' });
}));
router.post('/hours/preview', wrap(async (req, res) => {
  const days = normalizeHours(req.body?.days);
  res.json(await review(db, 'hours', days));
}));
router.put('/hours', wrap(async (req, res) => {
  const days = normalizeHours(req.body?.days);
  await db.transaction(async (client) => {
    await lock(client);
    const checked = await review(client, 'hours', days);
    if (req.body.reviewToken !== checked.reviewToken) fail('The schedule or affected appointments changed. Review the changes again.', 409);
    const current = normalizeHours((await loadSchedule(client)).days.map((d) => ({ ...d, opening_time: d.opening_time.slice(0,5), closing_time: d.closing_time.slice(0,5) })));
    if (JSON.stringify(current) === JSON.stringify(days)) return;
    const change = (await client.query('INSERT INTO clinic_schedule_changes(days,changed_by) VALUES($1,$2) RETURNING change_id', [JSON.stringify(days),req.session.userId])).rows[0];
    for (const day of days) await client.query('UPDATE clinic_operating_hours SET is_open=$2,opening_time=$3,closing_time=$4 WHERE weekday=$1', [day.weekday,day.is_open,day.opening_time,day.closing_time]);
    const restored = await client.query(`SELECT i.impact_id,a.appointment_id,a.user_id,a.aesthetician_id,
      a.appointment_date::text,a.appointment_time::text,a.appointment_end_time::text
      FROM clinic_appointment_impacts i JOIN appointments a USING(appointment_id)
      WHERE i.change_id IS NOT NULL AND i.resolution='pending'`);
    for (const appointment of restored.rows) {
      if (!fitsSchedule({ days, closures: [] }, appointment.appointment_date, appointment.appointment_time, appointment.appointment_end_time)) continue;
      await client.query("UPDATE clinic_appointment_impacts SET resolution='reopened',resolved_at=NOW() WHERE impact_id=$1", [appointment.impact_id]);
      await queueClinicEvent(client, { key: `hours:${change.change_id}:restored:${appointment.appointment_id}`, type: 'clinic_hours_restored',
        message: `Updated operating hours now accommodate appointment ${appointment.appointment_id} on ${appointment.appointment_date} at ${appointment.appointment_time.slice(0,5)} (Asia/Manila). Other closure restrictions and confirmed arrangements still apply.`,
        appointmentId: appointment.appointment_id, userIds: [appointment.user_id,appointment.aesthetician_id], roles: ['admin','staff'] });
    }
    await flag(client, checked.affectedAppointments, { changeId: change.change_id }, 'Clinic operating hours changed.');
    await queueClinicEvent(client, { key: `hours:${change.change_id}`, type: 'clinic_hours_updated', message: `Clinic operating hours were updated (Asia/Manila). ${checked.affectedAppointments.length} appointment(s) require resolution.`, roles: ['admin','staff','aesthetician'] });
    await bump(client);
  });
  void processClinicNotifications();
  res.json({ message: 'Operating hours saved. Affected appointments are Pending Resolution.' });
}));
router.post('/closures/preview', wrap(async (req,res) => {
  const input = closureInput(req.body || {});
  const closureId = req.body.closureId == null ? null : id(req.body.closureId);
  if (closureId && input.dates.length !== 1) fail('Edit one closure date at a time.');
  res.json(await review(db,'closure',input,closureId));
}));
router.post('/closures', wrap(async (req,res) => {
  const input = closureInput(req.body || {});
  await db.transaction(async (client) => {
    await lock(client);
    const checked = await review(client,'closure',input);
    if (req.body.reviewToken !== checked.reviewToken) fail('Affected appointments changed. Review the selected dates again.',409);
    for (const date of input.dates) {
      const closure = (await client.query('INSERT INTO clinic_closures(closure_date,reason,created_by) VALUES($1,$2,$3) RETURNING closure_id', [date,input.reason,req.session.userId])).rows[0];
      await flag(client,checked.affectedAppointments.filter((a) => a.appointment_date === date),{ closureId: closure.closure_id },`Clinic closure: ${input.reason}`);
      await queueClinicEvent(client,{ key: `closure:${closure.closure_id}:scheduled`, type: 'clinic_closure_scheduled', message: `Clinic closure scheduled for ${date} (Asia/Manila). Reason: ${input.reason}`, closureId: closure.closure_id,roles: ['admin','staff','aesthetician'] });
    }
    await bump(client);
  });
  void processClinicNotifications();
  res.status(201).json({ message: 'Closures scheduled. Affected customers and staff have been notified in the app; emails are queued.' });
}));
router.get('/closures/:id',wrap(async (req,res) => {
  const closureId=id(req.params.id);
  const closure=(await db.query('SELECT *,closure_date::text AS closure_date FROM clinic_closures WHERE closure_id=$1',[closureId])).rows[0];
  if (!closure) fail('Closure not found.',404);
  const appointments=await db.query(`SELECT i.*,i.original_date::text AS original_date,a.appointment_date::text,a.appointment_time::text,a.appointment_status,s.service_name,
    COALESCE(NULLIF(CONCAT_WS(' ',a.customer_first_name,a.customer_last_name),''),a.walk_in_name,'Client') AS client
    FROM clinic_appointment_impacts i JOIN appointments a USING(appointment_id) JOIN services s USING(service_id) WHERE i.closure_id=$1 ORDER BY i.impact_id`,[closureId]);
  const deliveries=await db.query(`SELECT d.delivery_id,d.email_status,d.attempts,d.last_error,d.sent_at,n.type,n.message,n.created_at,n.is_read,
    CONCAT_WS(' ',u.first_name,u.last_name) AS recipient,u.role
    FROM clinic_notification_deliveries d JOIN notifications n USING(notification_id) JOIN users u ON u.user_id=d.user_id
    WHERE d.closure_id=$1 OR d.appointment_id IN (SELECT appointment_id FROM clinic_appointment_impacts WHERE closure_id=$1)
    ORDER BY d.delivery_id DESC`,[closureId]);
  res.json({ closure,appointments:appointments.rows,deliveries:deliveries.rows });
}));
router.put('/closures/:id',wrap(async (req,res) => {
  const closureId=id(req.params.id),input=closureInput(req.body || {});
  if(input.dates.length!==1) fail('Edit one closure date at a time.');
  await db.transaction(async(client)=>{
    await lock(client);
    const closure=(await client.query('SELECT *,closure_date::text AS closure_date FROM clinic_closures WHERE closure_id=$1',[closureId])).rows[0];
    if(!closure) fail('Closure not found.',404);
    if(closure.reopened_at || closure.closure_date < manilaNow().dateStr) fail('Only current or scheduled closures can be edited.',409);
    const checked=await review(client,'closure',input,closureId);
    if(req.body.reviewToken!==checked.reviewToken || req.body.version!==closure.version) fail('Closure or affected appointments changed. Refresh and review again.',409);
    if(closure.closure_date===input.dates[0] && closure.reason===input.reason) return;
    await client.query('UPDATE clinic_closures SET closure_date=$2,reason=$3,version=version+1,updated_at=NOW() WHERE closure_id=$1',[closureId,input.dates[0],input.reason]);
    const oldImpacts=await client.query(`SELECT DISTINCT a.user_id,a.aesthetician_id FROM clinic_appointment_impacts i JOIN appointments a USING(appointment_id) WHERE i.closure_id=$1`,[closureId]);
    // Moving a closure releases the old date; previously flagged appointments retain an audit record.
    if(closure.closure_date!==input.dates[0]) await client.query("UPDATE clinic_appointment_impacts SET resolution='reopened',resolved_at=NOW() WHERE closure_id=$1 AND resolution='pending'",[closureId]);
    await flag(client,checked.affectedAppointments,{closureId},`Updated clinic closure: ${input.reason}`);
    // An appointment can be affected again if an edited closure moves back to its date.
    await client.query(`UPDATE clinic_appointment_impacts i SET resolution='pending',resolved_at=NULL
      FROM appointments a WHERE i.appointment_id=a.appointment_id AND i.closure_id=$1 AND a.appointment_date=$2
      AND a.appointment_status IN ('pending','confirmed','in_progress')`,[closureId,input.dates[0]]);
    await queueClinicEvent(client,{key:`closure:${closureId}:updated:${closure.version+1}`,type:'clinic_closure_updated',
      message:`Clinic closure updated from ${closure.closure_date} to ${input.dates[0]} (Asia/Manila). Reason: ${input.reason}. Staff will confirm any appointment arrangements.`,closureId,
      roles:['admin','staff','aesthetician'],userIds:oldImpacts.rows.flatMap(a=>[a.user_id,a.aesthetician_id])});
    await bump(client);
  });
  void processClinicNotifications();res.json({message:'Closure updated. Review pending appointments.'});
}));
router.post('/closures/:id/reopen',wrap(async(req,res)=>{
  const closureId=id(req.params.id);
  await db.transaction(async(client)=>{
    await lock(client);
    const closure=(await client.query('SELECT *,closure_date::text AS closure_date FROM clinic_closures WHERE closure_id=$1',[closureId])).rows[0];
    if(!closure) fail('Closure not found.',404);
    if(closure.reopened_at) return;
    if(closure.closure_date<manilaNow().dateStr) fail('Past closures remain in history and cannot be reopened.',409);
    if(req.body?.version!==closure.version) fail('Closure changed. Refresh before reopening.',409);
    await client.query('UPDATE clinic_closures SET reopened_at=NOW(),reopened_by=$2,version=version+1,updated_at=NOW() WHERE closure_id=$1',[closureId,req.session.userId]);
    await client.query(`UPDATE clinic_appointment_impacts SET resolution='reopened',resolved_at=NOW()
      WHERE closure_id=$1 AND resolution='pending'`,[closureId]);
    const users=await client.query('SELECT a.user_id,a.aesthetician_id FROM appointments a JOIN clinic_appointment_impacts i USING(appointment_id) WHERE i.closure_id=$1',[closureId]);
    await queueClinicEvent(client,{key:`closure:${closureId}:reopened`,type:'clinic_closure_reopened',message:`The clinic closure on ${closure.closure_date} (Asia/Manila) was reopened. Regular operating hours apply. Staff will confirm your appointment arrangements.`,closureId,
      roles:['admin','staff','aesthetician'],userIds:users.rows.flatMap(a=>[a.user_id,a.aesthetician_id])});
    await bump(client);
  });
  void processClinicNotifications();res.json({message:'Closure reopened. Regular hours and any other restrictions still apply.'});
}));
router.get('/deliveries',wrap(async(_req,res)=>{
  const deliveries=await db.query(`SELECT d.delivery_id,d.email_status,d.attempts,d.last_error,d.sent_at,n.type,n.message,n.created_at,
    CONCAT_WS(' ',u.first_name,u.last_name) AS recipient,u.role FROM clinic_notification_deliveries d
    JOIN notifications n USING(notification_id) JOIN users u ON u.user_id=d.user_id ORDER BY d.delivery_id DESC LIMIT 200`);
  res.json(deliveries.rows);
}));
router.post('/deliveries/:id/retry',wrap(async(req,res)=>{
  const result=await db.query("UPDATE clinic_notification_deliveries SET email_status='pending',attempts=0,attempted_at=NULL WHERE delivery_id=$1 AND email_status='failed' RETURNING delivery_id",[id(req.params.id)]);
  if(!result.rows.length) fail('Only failed email deliveries can be retried.',409);
  void processClinicNotifications();res.json({message:'Email retry queued. The existing bell notification is preserved.'});
}));
module.exports=router;
