const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');
const { manilaNow } = require('../utils/slots');

const exportRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/export.xlsx' && layer.route.methods.get)
  .route.stack.at(-1).handle;
const availabilityRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/walk-in-options' && layer.route.methods.get)
  .route.stack.at(-1).handle;
const originalQuery = db.query;
const originalDate = global.Date;

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(body) {
      this.body = body;
      return this;
    }
  };
}

async function withFrozenDate(isoDate, callback) {
  const timestamp = originalDate.parse(isoDate);
  global.Date = class extends originalDate {
    constructor(...args) {
      super(...(args.length ? args : [timestamp]));
    }

    static now() {
      return timestamp;
    }
  };
  try {
    return await callback();
  } finally {
    global.Date = originalDate;
  }
}

test('admin appointment export creates a formatted XLSX from the selected filters', async () => {
  const month = manilaNow().dateStr.slice(0, 7);
  const rows = [
    {
      appointment_id: 12,
      date: `${month}-14`,
      start: '13:30:00',
      end: '15:00:00',
      scheduled_end: '15:00:00',
      expected_end: '15:15:00',
      status: 'confirmed',
      service: 'Hydrating Facial',
      duration_minutes: 60,
      duration_is_estimated: false,
      buffer_minutes: 30,
      fee: 2500,
      deposit_amount: 500,
      payment_status: 'partially_paid',
      client: 'Client A',
      contact: '+639001234567',
      assigned_to: 'Staff A'
    },
    {
      appointment_id: 13,
      date: `${month}-15`,
      start: '09:00:00',
      status: 'confirmed',
      service: 'Hydrating Facial',
      client: 'Other Client',
      assigned_to: 'Staff B'
    },
    {
      appointment_id: 14,
      date: `${month}-16`,
      start: '09:00:00',
      status: 'cancelled',
      service: 'Hydrating Facial',
      client: 'Client A',
      assigned_to: 'Staff A'
    }
  ];
  db.query = async (sql) => {
    assert.match(sql, /FROM appointments a/);
    return { rows };
  };
  const response = responseCapture();

  try {
    await exportRoute({
      query: {
        status: 'confirmed',
        month,
        todayOnly: 'false',
        search: 'Client A'
      }
    }, response);
  } finally {
    db.query = originalQuery;
  }

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['Content-Type'], /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(response.headers['Content-Disposition'], new RegExp(`appointments-${month}\\.xlsx`));
  assert.ok(Buffer.isBuffer(response.body));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  const worksheet = workbook.getWorksheet('Appointments');
  assert.ok(worksheet);
  assert.equal(worksheet.rowCount, 2);
  assert.equal(worksheet.getCell('A1').value, 'Reference');
  assert.equal(worksheet.getCell('A2').value, 'APT-0012');
  assert.equal(worksheet.getCell('B2').value, 'Client A');
  assert.equal(worksheet.getCell('I2').value, 'Confirmed');
  assert.equal(worksheet.getCell('L2').value, 2500);
  assert.equal(worksheet.getCell('M2').value, 500);
  assert.equal(worksheet.getCell('D2').numFmt, 'dd mmm yyyy');
  assert.equal(worksheet.getCell('E2').numFmt, 'h:mm AM/PM');
  assert.equal(worksheet.getCell('L2').numFmt, '₱#,##0.00');
  assert.ok(worksheet.getColumn(3).width >= 30);
  assert.ok(worksheet.autoFilter);
  assert.equal(worksheet.views[0].ySplit, 1);
});

test('admin appointment export rejects invalid filter values', async () => {
  const response = responseCapture();
  const previousQuery = db.query;
  db.query = async () => {
    throw new Error('The database should not be queried for invalid filters.');
  };

  try {
    await exportRoute({ query: { status: 'invalid', month: '2026-13' } }, response);
  } finally {
    db.query = previousQuery;
  }

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /valid appointment status/);
});

test('editing availability accepts a valid long duration inside clinic hours and bypasses new-booking lead time', async () => {
  const queries = [];
  db.query = async (sql, values = []) => {
    queries.push({ sql, values });
    if (/SELECT service_id, booked_duration_minutes/.test(sql)) {
      return {
        rows: [{
          service_id: 3,
          booked_duration_minutes: 240,
          booked_buffer_minutes: 30,
          booked_duration_is_estimated: false
        }]
      };
    }
    if (/SELECT service_id, service_name, category, duration_minutes/.test(sql)) {
      return { rows: [{ service_id: 3, duration_minutes: 60, buffer_minutes: 30 }] };
    }
    if (/FROM clinic_operating_hours/.test(sql)) {
      return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
    }
    if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) {
      return { rows: [] };
    }
    if (/SELECT u\.user_id, u\.first_name/.test(sql)) {
      return { rows: [{ user_id: 31, first_name: 'Staff', last_name: 'One', role: 'aesthetician' }] };
    }
    return { rows: [] };
  };
  const response = responseCapture();

  try {
    await withFrozenDate('2026-01-05T02:30:00.000Z', () => availabilityRoute({
      query: {
        appointmentId: '42',
        serviceId: '3',
        date: '2026-01-05',
        time: '1:00 PM'
      }
    }, response));
  } finally {
    db.query = originalQuery;
  }

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.map((staff) => staff.user_id), [31]);
  const availabilityQuery = queries.find(({ sql }) => /SELECT u\.user_id, u\.first_name/.test(sql));
  assert.deepEqual(availabilityQuery.values, ['2026-01-05', '13:00', '17:30', 42]);
});

test('new appointment availability still enforces the three-hour booking lead time', async () => {
  db.query = async (sql) => {
    assert.match(sql, /SELECT service_id, service_name, category, duration_minutes/);
    return { rows: [{ service_id: 3, duration_minutes: 60, buffer_minutes: 30 }] };
  };
  const response = responseCapture();

  try {
    await withFrozenDate('2026-01-05T02:30:00.000Z', () => availabilityRoute({
      query: {
        serviceId: '3',
        date: '2026-01-05',
        time: '1:00 PM'
      }
    }, response));
  } finally {
    db.query = originalQuery;
  }

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /at least 3 hours/);
});
