const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assignTimes, buildPlan, applyPlan, source } = require('../scripts/replace-test-appointments');

test('October source keeps 21 textual treatments and excludes only the six numeric-code rows', () => {
  assert.equal(source.appointments.length, 21);
  assert.equal(source.excluded.length, 6);
  assert.deepEqual(source.excluded.map((item) => item.row), [12,17,21,22,24,27]);
  assert.equal(new Set(source.appointments.map((item) => item.row)).size, 21);
  assert.equal(new Set(source.appointments.map((item) => item.name)).size, 15);
  for (const item of source.appointments) {
    assert.match(item.date, /^2026-10-\d{2}$/);
    assert.doesNotMatch(item.treatment, /^(12\.12|10\.1|5\.5)$/);
  }
});

test('assigned slots fit clinic hours and lunch and cannot silently overflow a busy day', () => {
  const hours = Array.from({ length: 7 }, (_, weekday) => ({ weekday, is_open: true, opening_time: '09:00:00', closing_time: '18:00:00' }));
  const records = assignTimes(source.appointments, hours);
  assert.deepEqual(records.slice(0,5).map((item) => item.start), ['09:00:00','10:30:00','13:00:00','14:30:00','16:00:00']);
  assert.throws(() => assignTimes([...source.appointments.slice(0,5), { ...source.appointments[0], row: 99 }], hours), /Not enough clinic hours/);
  assert.throws(() => assignTimes(source.appointments, hours.map((day) => ({ ...day, is_open: false }))), /clinic is closed/);
});

test('PostgreSQL cleanup rolls back failures, preserves Mark and stock, imports once, and serves unknown facts accurately', {
  skip: !process.env.OCTOBER_IMPORT_TEST_DATABASE,
}, async () => {
  // This test deliberately deletes data in a restored, disposable copy only.
  assert.equal(process.env.DB_HOST, '127.0.0.1');
  assert.equal(process.env.DB_PORT, '55440');
  assert.equal(process.env.DB_NAME, 'sg_october_import_test');
  assert.equal(process.env.OCTOBER_IMPORT_TEST_DATABASE, process.env.DB_NAME);
  const pool = new Pool({ host: '127.0.0.1', port: 55440, user: 'postgres', database: process.env.DB_NAME });
  const client = await pool.connect();
  let appDb;
  try {
    const count = async (table) => Number((await client.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count);
    const mark = async () => (await client.query('SELECT to_jsonb(a) AS record FROM appointments a WHERE appointment_id=51')).rows[0].record;
    const stock = async () => (await client.query('SELECT jsonb_agg(to_jsonb(p) ORDER BY product_id) AS records FROM inventory_products p')).rows[0].records;
    const originalMark = await mark();
    const originalUserCount = await count('users');
    const originalStock = await stock();
    const originalInventoryCount = await count('inventory_transactions');
    const plan = await buildPlan(client);
    assert.equal(plan.deleteAppointments.length, 41);
    assert.equal(plan.deleteClients.length, 13);
    assert.equal(plan.insert.length, 21);
    await assert.rejects(applyPlan(client, 'wrong-fingerprint'), /fingerprint changed/);
    await client.query('BEGIN');
    await client.query("UPDATE users SET first_name='Wrong protected identity' WHERE user_id=28");
    await assert.rejects(buildPlan(client), /Protected Mark/);
    await client.query('ROLLBACK');

    await client.query('CREATE TABLE october_import_test_blocker(appointment_id INT REFERENCES appointments(appointment_id))');
    await client.query('INSERT INTO october_import_test_blocker VALUES(1)');
    await assert.rejects(applyPlan(client, plan.fingerprint), /foreign key constraint/);
    assert.equal(await count('appointments'), 42);
    assert.equal(await count('users'), originalUserCount);
    assert.deepEqual(await mark(), originalMark);
    assert.deepEqual(await stock(), originalStock);
    await client.query('DROP TABLE october_import_test_blocker');

    const result = await applyPlan(client, plan.fingerprint);
    assert.equal(result.deletedAppointments, 41);
    assert.equal(result.deletedClients, 13);
    assert.equal(result.imported.length, 21);
    assert.equal(await count('appointments'), 22);
    assert.equal(Number((await client.query("SELECT COUNT(*) AS count FROM users WHERE role='client'")).rows[0].count), 1);
    assert.equal(await count('inventory_transactions'), originalInventoryCount);
    assert.deepEqual(await stock(), originalStock);
    const currentMark = await mark();
    delete currentMark.historical_import_key;
    delete currentMark.historical_source;
    assert.deepEqual(currentMark, originalMark);
    assert.deepEqual((await client.query('SELECT appointment_id,amount::text FROM payments')).rows, [{ appointment_id:51, amount:'100.00' }]);
    assert.equal(Number((await client.query(`SELECT COUNT(*) AS count FROM appointments WHERE historical_import_key IS NOT NULL
      AND appointment_status='completed' AND payment_status='not_recorded' AND aesthetician_id IS NULL
      AND booked_service_price IS NULL AND booked_reservation_fee IS NULL AND booked_duration_is_estimated
      AND historical_source->>'time_assigned_by_admin'='true'`)).rows[0].count), 21);
    await assert.rejects(client.query('UPDATE appointments SET booked_service_price=NULL WHERE appointment_id=51'), /appointments_historical_prices/);
    await assert.rejects(client.query("UPDATE appointments SET payment_status='not_recorded' WHERE appointment_id=51"), /appointments_historical_prices/);
    await assert.rejects(client.query('UPDATE services SET is_active=TRUE WHERE is_historical_only'), /services_historical_prices/);
    await assert.rejects(client.query('UPDATE services SET service_price=NULL WHERE service_id=25'), /services_historical_prices/);
    const second = await applyPlan(client, (await buildPlan(client)).fingerprint);
    assert.equal(second.deletedAppointments, 0);
    assert.equal(second.deletedClients, 0);
    assert.equal(second.imported.length, 0);
    assert.equal(await count('appointments'), 22);

    // Exercise the app's actual listing and XLSX handlers against the local copy.
    appDb = require('../db');
    const router = require('../routes/appointments');
    const handler = (path) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods.get).route.stack.at(-1).handle;
    const capture = () => ({ statusCode:200, status(code) { this.statusCode=code;return this; }, json(body) { this.body=body;return this; }, setHeader() {}, send(body) { this.body=body;return this; } });
    const response = capture();
    await handler('/admin')({}, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.length, 22);
    const importedRows = response.body.filter((row) => row.is_historical_record);
    assert.equal(importedRows.length, 21);
    assert.ok(importedRows.every((row) => row.time_assigned_by_admin && row.fee === null && row.assigned_to === 'Unassigned'));
    const exportResponse = capture();
    await handler('/admin/export.xlsx')({ query:{ status:'completed',month:'2026-10' } }, exportResponse);
    assert.equal(exportResponse.statusCode, 200);
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResponse.body);
    const sheet = workbook.getWorksheet('Appointments');
    assert.equal(sheet.rowCount, 22);
    assert.equal(sheet.getRow(2).getCell(12).value, null);
    assert.equal(sheet.getRow(2).getCell(13).value, null);
    assert.ok(sheet.getRow(2).getCell(5).note);
    const serviceRouter = require('../routes/services');
    const serviceHandler = serviceRouter.stack.find((layer) => layer.route?.path === '/admin' && layer.route.methods.get).route.stack.at(-1).handle;
    const services = capture();
    await serviceHandler({}, services);
    assert.equal(services.statusCode, 200);
    assert.equal(services.body.length, 70);
    assert.ok(services.body.every((service) => service.category !== 'Historical records'));
  } finally {
    client.release();
    await pool.end();
    if (appDb) await appDb.pool.end();
  }
});
