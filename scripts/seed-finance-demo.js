if (process.env.NODE_ENV === 'production') {
  console.error('Finance demo data is disabled in production.');
  process.exit(1);
}

const db = require('../db');

const categories = ['Inventory & Supplies', 'Salaries & Commissions', 'Rent', 'Utilities', 'Marketing', 'Equipment Maintenance', 'Other'];
const methods = ['paymongo', 'cash', 'gcash', 'card'];

function dateOffset(daysAgo) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function clearDemo() {
  await db.transaction(async (client) => {
    const appointments = await client.query(`SELECT DISTINCT appointment_id FROM payments WHERE note = 'DEMO' AND appointment_id IS NOT NULL`);
    const ids = appointments.rows.map((row) => row.appointment_id);
    await client.query(`DELETE FROM payments WHERE note = 'DEMO'`);
    await client.query(`DELETE FROM expenses WHERE description LIKE 'DEMO:%'`);
    if (ids.length) {
      await client.query(`DELETE FROM appointments a WHERE a.appointment_id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.appointment_id)`, [ids]);
    }
  });
  console.log('Removed tagged finance demo payments, expenses, and unreferenced demo appointments.');
}

async function seedDemo() {
  const clientResult = await db.query(`SELECT user_id FROM users WHERE role = 'client' ORDER BY user_id LIMIT 1`);
  const servicesResult = await db.query(`SELECT service_id, service_price, reservation_fee, duration_minutes FROM services WHERE is_active = TRUE ORDER BY service_id`);
  if (!clientResult.rows.length || !servicesResult.rows.length) {
    throw new Error('At least one client account and one active service are required to seed finance demo data.');
  }
  const clientId = clientResult.rows[0].user_id;
  const services = servicesResult.rows;
  const userResult = await db.query(`SELECT user_id FROM users WHERE role = 'admin' ORDER BY user_id LIMIT 1`);
  const recordedBy = userResult.rows[0]?.user_id || null;

  await db.transaction(async (client) => {
    for (let index = 0; index < 60; index += 1) {
      const date = dateOffset(59 - index);
      const service = services[index % services.length];
      const isNoShow = index % 12 === 0;
      const price = Number(service.service_price);
      const deposit = Number(service.reservation_fee);
      const endMinutes = 10 * 60 + 15 + Number(service.duration_minutes);
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;
      const appointment = await client.query(`
        INSERT INTO appointments
          (user_id, service_id, booked_service_price, booked_reservation_fee, payment_status,
           appointment_date, appointment_time, appointment_end_time, appointment_status,
           aesthetician_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'paid', $5::date, '10:15:00', $6::time, $7, NULL,
                ($5::date::timestamp + INTERVAL '12 hours'), ($5::date::timestamp + INTERVAL '12 hours'))
        RETURNING appointment_id
      `, [clientId, service.service_id, price, deposit, date, endTime, isNoShow ? 'no_show' : 'completed']);
      await client.query(`
        INSERT INTO payments (appointment_id, payment_type, amount, method, reference_no, note, recorded_by, created_at)
        VALUES ($1, 'reservation', $2, $3, $4, 'DEMO', $5, ($6::date::timestamp + INTERVAL '12 hours'))
        ON CONFLICT (appointment_id) WHERE payment_type = 'reservation' AND appointment_id IS NOT NULL DO NOTHING
      `, [appointment.rows[0].appointment_id, deposit, methods[index % methods.length], `DEMO-DEP-${String(index + 1).padStart(4, '0')}`, recordedBy, date]);
      if (!isNoShow && index % 3 !== 0) {
        const balance = Math.max(0.01, Math.round((price - deposit) * 100) / 100);
        await client.query(`INSERT INTO payments (appointment_id, payment_type, amount, method, reference_no, note, recorded_by, created_at) VALUES ($1, 'balance', $2, $3, $4, 'DEMO', $5, ($6::date::timestamp + INTERVAL '13 hours'))`, [appointment.rows[0].appointment_id, balance, methods[(index + 1) % methods.length], `DEMO-BAL-${String(index + 1).padStart(4, '0')}`, recordedBy, date]);
      }
    }

    for (let index = 0; index < 12; index += 1) {
      const date = dateOffset(index * 5);
      await client.query(`INSERT INTO payments (payment_type, amount, method, reference_no, note, recorded_by, created_at) VALUES ('product_sale', $1, $2, $3, 'DEMO', $4, ($5::date::timestamp + INTERVAL '14 hours'))`, [250 + (index * 85), methods[index % methods.length], `DEMO-PROD-${String(index + 1).padStart(4, '0')}`, recordedBy, date]);
    }

    for (let index = 0; index < 25; index += 1) {
      const date = dateOffset((index * 2) % 60);
      const category = categories[index % categories.length];
      await client.query(`INSERT INTO expenses (expense_date, category, description, amount, supplier, reference_no, recorded_by) VALUES ($1::date, $2, $3, $4, $5, $6, $7)`, [date, category, `DEMO: ${category} purchase ${index + 1}`, 350 + (index * 137.5), `Demo Supplier ${index % 5 + 1}`, `DEMO-EXP-${String(index + 1).padStart(4, '0')}`, recordedBy]);
    }
  });
  console.log('Inserted 60 demo appointments, 72 demo payments, and 25 expenses across the last 60 days.');
}

async function main() {
  try {
    if (process.argv.includes('--clear')) await clearDemo();
    else await seedDemo();
  } catch (error) {
    console.error('Finance demo seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

main();