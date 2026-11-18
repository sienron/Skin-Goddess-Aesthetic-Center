const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const db = require('../db');
const router = require('../routes/finance');
const { appointmentRecords } = require('../utils/financeOperationalAnalytics');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (error) {
  if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
}

function handler(pathname) {
  return router.stack.find((layer) => layer.route?.path === pathname && layer.route.methods.get).route.stack.at(-1).handle;
}

function response() {
  return {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

test('operational charts and exports agree on filtered payment and appointment fixtures', { skip: !DatabaseSync }, async () => {
  const fixture = new DatabaseSync(':memory:');
  fixture.exec(`
    CREATE TABLE services (service_id INTEGER, service_name TEXT);
    CREATE TABLE appointments (appointment_id INTEGER, service_id INTEGER, appointment_date TEXT,
      booking_source TEXT, appointment_status TEXT, payment_status TEXT, booked_service_price NUMERIC, is_demo BOOLEAN);
    CREATE TABLE payments (payment_id INTEGER, appointment_id INTEGER, payment_type TEXT, amount NUMERIC,
      method TEXT, status TEXT, reference_no TEXT, created_at TEXT);
    INSERT INTO services VALUES (1, 'Facial');
    INSERT INTO appointments VALUES
      (1,1,'2026-10-01','online','confirmed','paid',1000,0),
      (2,1,'2026-10-02','walk_in','completed','paid',1000,0),
      (3,1,'2026-10-03',NULL,'confirmed','unpaid',1000,0),
      (4,1,'2026-10-04',NULL,'completed','not_recorded',NULL,0),
      (5,1,'2026-10-05','walk_in','cancelled','paid',1000,0),
      (6,1,'2026-10-06','online','confirmed','paid',1000,1),
      (7,1,'2026-11-02','online','confirmed','paid',1000,0);
    INSERT INTO payments VALUES
      (1,1,'reservation',300,'paymongo','posted','R1','2026-09-30 16:30:00'),
      (2,2,'reservation',300,'cash','posted','R2','2026-10-02 01:00:00'),
      (3,2,'balance',700,'cash','posted','R3','2026-10-03 02:00:00'),
      (4,NULL,'product_sale',100,'cash','posted','R4','2026-10-03 02:00:00'),
      (5,5,'reservation',150,'paymongo','posted','R5','2026-10-05 02:00:00'),
      (6,7,'reservation',50,'cash','posted','R6','2026-10-06 02:00:00'),
      (7,3,'reservation',300,'cash','refunded','R7','2026-10-03 03:00:00'),
      (8,3,'balance',700,'cash','reversed','R8','2026-10-03 04:00:00'),
      (9,3,'balance',700,'cash','pending','R9','2026-10-03 05:00:00'),
      (10,6,'reservation',999,'cash','posted','R10','2026-10-06 02:00:00'),
      (11,5,'balance',700,'cash','posted','R11','2026-10-31 16:10:00');
  `);
  const originalQuery = db.query;
  const sqlSeen = [];
  db.query = async (sql, values) => {
    sqlSeen.push(sql);
    // Postgres-only queries for the supplementary charts are covered by the live-query check, not this sqlite fixture.
    if (/product_sale_details|inventory_transactions|generate_series/.test(sql)) return { rows: [] };
    const sqliteSql = sql
      .replace(/\(p\.created_at AT TIME ZONE 'Asia\/Manila'\)::date/g, "date(datetime(p.created_at, '+8 hours'))")
      .replace(/::(?:text|date|float8|boolean)/g, '')
      .replace(/\$(\d+)/g, '?$1');
    return { rows: fixture.prepare(sqliteSql).all(...values.map((value) => typeof value === 'boolean' ? Number(value) : value)) };
  };
  const query = { from: '2026-10-01', to: '2026-10-31' };
  try {
    const result = response();
    await handler('/report')({ query: { ...query, view: 'operational' } }, result);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.revenue_by_service, [{ label: 'Facial', value: 1500 }]);
    assert.deepEqual(Object.fromEntries(result.body.appointment_source.map((row) => [row.label, row.value])), {
      'Walk-in': 2, Unknown: 2, 'Online reservation': 1,
    });
    assert.deepEqual(Object.fromEntries(result.body.payment_status.map((row) => [row.label, row.value])), {
      'Fully Paid': 1, 'Partially Paid': 1, Unpaid: 1,
    });
    assert.deepEqual(Object.fromEntries(result.body.payment_methods.map((row) => [row.label, row.value])), {
      cash: 4, paymongo: 2,
    });
    assert.match(sqlSeen[0], /p\.status = 'posted'/);
    assert.match(sqlSeen[1], /p\.status = 'posted' AND p\.payment_type IN \('reservation', 'balance'\)/);
    assert.match(sqlSeen[1], /\$3::boolean OR p\.payment_type <> 'reservation'/);

    const singleDay = response();
    await handler('/report')({ query: { from: '2026-10-02', to: '2026-10-02', view: 'operational' } }, singleDay);
    assert.deepEqual(singleDay.body.revenue_by_service, [{ label: 'Facial', value: 300 }]);
    assert.deepEqual(singleDay.body.payment_status, [{ label: 'Fully Paid', value: 1 }]);
    assert.deepEqual(singleDay.body.payment_methods, [{ label: 'cash', value: 1 }]);

    for (const [chart, title, ids, idColumn] of [
      ['collected-services', 'Revenue by Service', ['1', '2', '3', '5', '6'], 'C'],
      ['payment-counts', 'Payment Methods', ['1', '2', '3', '4', '5', '6'], 'C'],
      ['appointment-source', 'Appointment Source', ['1', '2', '3', '4', '5'], 'B'],
      ['appointment-payment-status', 'Payment Status', ['1', '2', '3'], 'B'],
    ]) {
      const exported = response();
      await handler('/export.xlsx')({ query: { ...query, section: 'report-chart', chart } }, exported);
      assert.equal(exported.statusCode, 200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(exported.body);
      const sheet = workbook.getWorksheet(title);
      const actual = [];
      for (let row = 2; row <= sheet.rowCount; row += 1) actual.push(String(sheet.getCell(`${idColumn}${row}`).value));
      assert.deepEqual(actual, ids);
    }
  } finally {
    db.query = originalQuery;
    fixture.close();
  }
});

test('unknown prices and cancelled appointments do not acquire a balance status', () => {
  const rows = appointmentRecords([
    { booking_source: null, appointment_status: 'completed', payment_status: 'not_recorded', service_price: null, amount_paid: 0 },
    { booking_source: 'walk_in', appointment_status: 'cancelled', payment_status: 'paid', service_price: 100, amount_paid: 100 },
  ]);
  assert.equal(rows[0].source_label, 'Unknown');
  assert.equal(rows[0].balance_status, null);
  assert.equal(rows[1].balance_status, null);
});

test('source migration and creation paths only classify verified booking channels', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const migration = read('migrations', '058-appointment-booking-source.js');
  const appointments = read('routes', 'appointments.js');
  assert.match(migration, /booking_source IS NULL[\s\S]*paymongo_checkout_sessions[\s\S]*checkout\.appointment_id = a\.appointment_id/);
  assert.doesNotMatch(migration, /walk_in_name|payment_method/);
  assert.match(appointments, /appointment_status, payment_status, booking_source\)[\s\S]*?'unpaid', 'walk_in'/);
  assert.match(appointments, /customer_first_name, customer_last_name, customer_email, customer_phone, booking_source[\s\S]*?FALSE, \$11, \$12, \$13, \$14, 'online'/);
});
