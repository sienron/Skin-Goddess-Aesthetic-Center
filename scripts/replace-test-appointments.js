// One-time, bounded maintenance task. The default command only previews data.
const crypto = require('node:crypto');
const source = require('./data/october-2026-appointments.json');
const { migrate } = require('../migrations/052-historical-appointment-records');

const TEST_APPOINTMENT_IDS = [1,2,3,4,5,6,7,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,42,43,44,45,46,47,48,49,50,52,53,54,55,56,57,58];
const TEST_CLIENT_IDS = [4,12,13,15,16,17,18,19,22,29,38,39,40];
const KEEP_APPOINTMENT_ID = 51;
const KEEP_CLIENT_ID = 28;
const IMPORT_PREFIX = 'client-october-2026:row:';

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function clock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
}

function minutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

function assignTimes(records, hours) {
  const nextByDate = new Map();
  return records.map((record) => {
    const weekday = new Date(`${record.date}T00:00:00Z`).getUTCDay();
    const day = hours.find((item) => Number(item.weekday) === weekday);
    if (!day?.is_open) throw new Error(`Cannot assign a time on ${record.date}: the clinic is closed.`);
    let start = nextByDate.get(record.date) ?? Math.ceil(minutes(day.opening_time) / 30) * 30;
    if (start < 13 * 60 && start + 90 > 12 * 60) start = 13 * 60;
    if (start + 90 > minutes(day.closing_time)) throw new Error(`Not enough clinic hours on ${record.date}.`);
    nextByDate.set(record.date, start + 90);
    return { ...record, key: `${IMPORT_PREFIX}${record.row}`, start: clock(start), end: clock(start + 90) };
  });
}

async function protectedRecords(client) {
  const user = (await client.query('SELECT to_jsonb(u) AS record FROM users u WHERE user_id=$1', [KEEP_CLIENT_ID])).rows[0]?.record;
  const appointment = (await client.query('SELECT to_jsonb(a) AS record FROM appointments a WHERE appointment_id=$1', [KEEP_APPOINTMENT_ID])).rows[0]?.record;
  if (!user || `${user.first_name} ${user.last_name}` !== 'Mark Sienron Aguilar'
      || user.role !== 'client' || appointment?.user_id !== KEEP_CLIENT_ID
      || appointment.service_id !== 25 || appointment.appointment_date !== '2026-11-12') {
    throw new Error('Protected Mark Sienron Aguilar / appointment #51 does not match. Nothing may be removed.');
  }
  const payments = (await client.query('SELECT to_jsonb(p) AS record FROM payments p WHERE appointment_id=$1 ORDER BY payment_id', [KEEP_APPOINTMENT_ID])).rows;
  return { user, appointment, payments };
}

async function buildPlan(client) {
  const keep = await protectedRecords(client);
  const appointments = (await client.query('SELECT to_jsonb(a) AS record FROM appointments a WHERE appointment_id=ANY($1::int[]) ORDER BY appointment_id', [TEST_APPOINTMENT_IDS])).rows.map((item) => item.record);
  const clients = (await client.query('SELECT to_jsonb(u) AS record FROM users u WHERE user_id=ANY($1::int[]) ORDER BY user_id', [TEST_CLIENT_IDS])).rows.map((item) => item.record);
  if (clients.some((item) => item.role !== 'client')) throw new Error('A cleanup client ID now belongs to staff. Refusing deletion.');
  if (appointments.some((item) => item.user_id === KEEP_CLIENT_ID)) throw new Error('A cleanup appointment belongs to Mark. Refusing deletion.');
  const hasImportKey = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='historical_import_key'")).rowCount > 0;
  const imported = hasImportKey
    ? (await client.query(`SELECT a.historical_import_key AS key, a.walk_in_name AS name, a.appointment_date::text AS date,
          a.appointment_time::text AS start, a.appointment_end_time::text AS end, a.appointment_status AS status,
          s.service_name AS treatment FROM appointments a JOIN services s USING(service_id)
          WHERE historical_import_key LIKE $1 ORDER BY historical_import_key`, [`${IMPORT_PREFIX}%`])).rows
    : [];
  const hours = (await client.query('SELECT weekday,is_open,opening_time::text,closing_time::text FROM clinic_operating_hours ORDER BY weekday')).rows;
  const records = assignTimes(source.appointments, hours);
  for (const existing of imported) {
    const expected = records.find((record) => record.key === existing.key);
    if (!expected || ['name','date','start','end','treatment'].some((field) => existing[field] !== expected[field]) || existing.status !== 'completed') {
      throw new Error(`Imported record ${existing.key} differs from the approved source. Refusing to overwrite it.`);
    }
  }
  return {
    fingerprint: fingerprint({ keep, appointments, clients, imported, records }),
    keep: { client: 'Mark Sienron Aguilar', clientId: KEEP_CLIENT_ID, appointmentId: KEEP_APPOINTMENT_ID },
    deleteAppointments: appointments.map((item) => ({ id: item.appointment_id, name: item.walk_in_name || `${item.customer_first_name || ''} ${item.customer_last_name || ''}`.trim() })),
    deleteClients: clients.map((item) => ({ id: item.user_id, name: `${item.first_name} ${item.last_name}` })),
    insert: records.filter((record) => !imported.some((item) => item.key === record.key)),
    alreadyImported: imported.length,
    excluded: source.excluded,
  };
}

async function purgeTestData(client, plan) {
  const appts = plan.deleteAppointments.map((item) => item.id);
  const clients = plan.deleteClients.map((item) => item.id);
  // Keep inventory stock and its transaction audit. The appointment FK becomes NULL.
  const deliveries = await client.query(`DELETE FROM clinic_notification_deliveries
    WHERE appointment_id=ANY($1::int[]) OR user_id=ANY($2::int[]) RETURNING delivery_id,notification_id`, [appts, clients]);
  await client.query('DELETE FROM clinic_appointment_impacts WHERE appointment_id=ANY($1::int[])', [appts]);
  await client.query('DELETE FROM appointment_inventory_deductions WHERE appointment_id=ANY($1::int[])', [appts]);
  const payments = (await client.query('SELECT payment_id,payment_type FROM payments WHERE appointment_id=ANY($1::int[])', [appts])).rows;
  if (payments.some((item) => item.payment_type === 'product_sale')) throw new Error('A selected appointment has a product sale; refusing to remove unrelated finance data.');
  await client.query('DELETE FROM payment_reversals WHERE payment_id=ANY($1::int[])', [payments.map((item) => item.payment_id)]);
  await client.query('DELETE FROM payments WHERE appointment_id=ANY($1::int[])', [appts]);
  await client.query(`DELETE FROM paymongo_checkout_sessions
    WHERE (appointment_id=ANY($1::int[]) OR user_id=ANY($2::int[]))
      AND appointment_id IS DISTINCT FROM $3 AND user_id IS DISTINCT FROM $4`, [appts, clients, KEEP_APPOINTMENT_ID, KEEP_CLIENT_ID]);
  await client.query('DELETE FROM appointments WHERE appointment_id=ANY($1::int[])', [appts]);
  await client.query('DELETE FROM notifications WHERE notification_id=ANY($1::bigint[])', [deliveries.rows.map((item) => item.notification_id).filter(Boolean)]);
  if (appts.length) {
    await client.query(`DELETE FROM notifications n
      WHERE message ~* $1
        AND NOT EXISTS(SELECT 1 FROM clinic_notification_deliveries d WHERE d.notification_id=n.notification_id)`,
    [`\\mappointment\\s+#?(${appts.join('|')})\\M`]);
  }
  if (deliveries.rowCount) {
    await client.query(`DELETE FROM notifications WHERE type='clinic_email_failed' AND message ~ $1`,
      [`^Clinic email delivery (${deliveries.rows.map((item) => item.delivery_id).join('|')})\\M`]);
  }
  // Sessions do not have a users FK. Remove only sessions for the selected test clients.
  await client.query("DELETE FROM user_sessions WHERE sess->>'userId'=ANY($1::text[])", [clients.map(String)]);
  await client.query('DELETE FROM users WHERE user_id=ANY($1::int[]) AND role=\'client\'', [clients]);
}

async function importRecords(client, records) {
  const imported = [];
  for (const record of records) {
    let service = (await client.query('SELECT service_id FROM services WHERE service_name=$1', [record.treatment])).rows[0];
    if (!service) {
      service = (await client.query(`INSERT INTO services
        (service_name,category,description,duration_minutes,buffer_minutes,service_price,reservation_fee,is_active,is_historical_only)
        VALUES($1,'Historical records',$2,60,30,NULL,NULL,FALSE,TRUE) RETURNING service_id`,
      [record.treatment, 'Original treatment label from the client October 2026 record. Actual duration and prices were not recorded.'])).rows[0];
    }
    const metadata = { source: source.source, sheet_row: record.row, original_treatment: record.treatment,
      time_assigned_by_admin: true, original_time: null, original_duration: null,
      original_price: null, original_payment: null, original_staff: null, status_assumed_completed: true };
    const result = await client.query(`INSERT INTO appointments
      (user_id,walk_in_name,service_id,aesthetician_id,appointment_date,appointment_time,
       appointment_end_time,scheduled_end_time,booked_duration_minutes,booked_buffer_minutes,
       booked_duration_is_estimated,booked_service_price,booked_reservation_fee,appointment_status,
       payment_status,historical_import_key,historical_source,is_demo,
       reminder_24h_sent,reminder_3h_sent,reminder_email_24h_sent,reminder_email_3h_sent)
      VALUES(NULL,$1,$2,NULL,$3,$4,$5,$5,60,30,TRUE,NULL,NULL,'completed','not_recorded',$6,$7,FALSE,TRUE,TRUE,TRUE,TRUE)
      RETURNING appointment_id`, [record.name,service.service_id,record.date,record.start,record.end,record.key,metadata]);
    imported.push({ id: result.rows[0].appointment_id, ...record });
  }
  return imported;
}

async function applyPlan(client, expectedFingerprint) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query('SELECT pg_advisory_xact_lock(5032026,1)');
    await client.query('LOCK TABLE users, appointments, services IN SHARE ROW EXCLUSIVE MODE');
    const plan = await buildPlan(client);
    if (!expectedFingerprint || plan.fingerprint !== expectedFingerprint) throw new Error('Preview fingerprint changed. Run the preview again before applying.');
    const before = await protectedRecords(client);
    const staff = (await client.query("SELECT jsonb_agg(to_jsonb(u) ORDER BY user_id) AS records FROM users u WHERE role IS DISTINCT FROM 'client'")).rows[0].records;
    const stock = (await client.query('SELECT jsonb_agg(to_jsonb(p) ORDER BY product_id) AS records FROM inventory_products p')).rows[0].records;
    await migrate(client);
    // Schema adds NULL provenance fields to Mark's row; compare after schema setup.
    const markAfterSchema = await protectedRecords(client);
    await purgeTestData(client, plan);
    const imported = await importRecords(client, plan.insert);
    const after = await protectedRecords(client);
    if (fingerprint(after) !== fingerprint(markAfterSchema)
        || fingerprint(before.user) !== fingerprint(after.user)
        || fingerprint(before.payments) !== fingerprint(after.payments)) throw new Error('Protected Mark records changed. Rolling back.');
    const remainingStaff = (await client.query("SELECT jsonb_agg(to_jsonb(u) ORDER BY user_id) AS records FROM users u WHERE role IS DISTINCT FROM 'client'")).rows[0].records;
    const remainingStock = (await client.query('SELECT jsonb_agg(to_jsonb(p) ORDER BY product_id) AS records FROM inventory_products p')).rows[0].records;
    if (fingerprint(staff) !== fingerprint(remainingStaff) || fingerprint(stock) !== fingerprint(remainingStock)) throw new Error('Staff or stock changed. Rolling back.');
    const total = Number((await client.query('SELECT COUNT(*) AS count FROM appointments WHERE historical_import_key LIKE $1', [`${IMPORT_PREFIX}%`])).rows[0].count);
    if (total !== source.appointments.length) throw new Error('Imported appointment total differs from the source. Rolling back.');
    await client.query('COMMIT');
    return { deletedAppointments: plan.deleteAppointments.length, deletedClients: plan.deleteClients.length, imported, alreadyImported: plan.alreadyImported, protected: plan.keep };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  require('dotenv').config({ quiet: true });
  const { Pool } = require('pg');
  const { getPostgresSslConfig } = require('../utils/postgresConfig');
  const args = process.argv.slice(2);
  const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const apply = args.includes('--apply');
  if (apply && (value('--expected-host') !== process.env.DB_HOST || value('--expected-database') !== process.env.DB_NAME)) {
    throw new Error('--apply requires an exact --expected-host and --expected-database match.');
  }
  const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: getPostgresSslConfig(), connectionTimeoutMillis:15000, allowExitOnIdle:true });
  const client = await pool.connect();
  try {
    const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (database !== process.env.DB_NAME) throw new Error('Connected database differs from DB_NAME.');
    const result = apply ? await applyPlan(client, value('--fingerprint')) : await buildPlan(client);
    console.log(JSON.stringify({ target: { host: process.env.DB_HOST, database }, mode: apply ? 'applied' : 'preview', ...result }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => { console.error('Appointment maintenance failed:', error.message); process.exitCode = 1; });
module.exports = { TEST_APPOINTMENT_IDS, TEST_CLIENT_IDS, assignTimes, buildPlan, applyPlan, source };
