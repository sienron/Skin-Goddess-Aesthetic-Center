const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../db');

const testimonials = [
  { client: 'Avery S', comment: 'I had such a great experience at Skin Goddess. The staff was welcoming and explained everything clearly before starting my treatment. I felt comfortable throughout the entire appointment, and they also gave me helpful advice on how to take care of my skin afterward. I really appreciated how attentive and professional everyone was.', rating: 5 },
  { client: 'Blake S', comment: 'Booking my appointment was really easy, and the whole process from arrival to the end of my treatment was smooth. The staff took the time to listen to my concerns and recommended a treatment that suited what I needed. I never felt rushed, and the aftercare advice was really helpful. I would definitely come back again.', rating: 5 },
  { client: 'Casey S', comment: 'I’m very happy with my experience at Skin Goddess. The clinic was clean, relaxing, and the staff were friendly from the moment I arrived. They explained each step of the treatment so I knew what to expect, and I felt well taken care of the entire time. The service was professional while still feeling warm and personal.', rating: 5 },
  { client: 'Drew S', comment: 'The staff were friendly and made me feel comfortable throughout my appointment.', rating: 5 },
  { client: 'Emery S', comment: 'Professional service, easy booking, and a really pleasant experience overall. Every detail was handled with great care, and the team made sure all of my questions were answered promptly', rating: 5 },
  { client: 'Finley S', comment: 'The clinic was clean, relaxing, and the staff were very attentive.', rating: 5 },
  { client: 'Gray S', comment: 'Great service and helpful aftercare advice. I’ll definitely come back.', rating: 5 },
];

async function seedDemoTestimonials() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo testimonials cannot be seeded in production.');
  }
  if (process.env.DB_HOST && !['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST)) {
    throw new Error('Demo testimonials may only be seeded into a local database.');
  }
  if (!process.argv.includes('--confirm-demo-data')) {
    throw new Error('Pass --confirm-demo-data to seed demo testimonials into the configured database.');
  }

  await db.transaction(async (client) => {
    const staffResult = await client.query(`
      SELECT user_id
      FROM users
      WHERE role = 'aesthetician' AND status = 'active'
      ORDER BY user_id
      LIMIT 1
    `);
    if (!staffResult.rows.length) throw new Error('No active aesthetician exists to associate with demo appointments.');

    const serviceResult = await client.query(`
      SELECT service_id, service_price, reservation_fee, duration_minutes
      FROM services
      WHERE is_active IS DISTINCT FROM FALSE
      ORDER BY service_id
      LIMIT 7
    `);
    if (!serviceResult.rows.length) throw new Error('No active services exist to associate with demo appointments.');

    const staffId = staffResult.rows[0].user_id;
    for (let index = 0; index < testimonials.length; index += 1) {
      const testimonial = testimonials[index];
      const email = `testimonial-demo-${String(index + 1).padStart(2, '0')}@example.invalid`;
      const [firstName, ...lastNameParts] = testimonial.client.split(' ');
      const lastName = lastNameParts.join(' ');
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

      await client.query(`
        INSERT INTO users (email, password_hash, first_name, last_name, email_verified, role)
        VALUES ($1, $2, $3, $4, FALSE, 'client')
        ON CONFLICT (email) DO UPDATE
        SET first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name
      `, [email, passwordHash, firstName, lastName]);

      const userResult = await client.query('SELECT user_id FROM users WHERE email = $1', [email]);
      const clientId = userResult.rows[0].user_id;
      const service = serviceResult.rows[index % serviceResult.rows.length];
      const appointmentDate = `2025-01-${String(index + 1).padStart(2, '0')}`;
      const appointmentTime = '10:00';

      await client.query(`
        INSERT INTO appointments (
          user_id, service_id, booked_service_price, booked_reservation_fee,
          payment_status, appointment_date, appointment_time, appointment_end_time,
          appointment_status, aesthetician_id
        )
        SELECT $1, $2, $3, $4, 'paid', $5, $6,
               $6::time + ($7 * INTERVAL '1 minute'), 'completed', $8
        WHERE NOT EXISTS (
          SELECT 1 FROM appointments
          WHERE user_id = $1 AND appointment_date = $5 AND appointment_time = $6
        )
      `, [
        clientId,
        service.service_id,
        service.service_price,
        service.reservation_fee,
        appointmentDate,
        appointmentTime,
        service.duration_minutes,
        staffId,
      ]);

      const appointmentResult = await client.query(`
        SELECT appointment_id
        FROM appointments
        WHERE user_id = $1 AND appointment_date = $2 AND appointment_time = $3
      `, [clientId, appointmentDate, appointmentTime]);

      await client.query(`
        INSERT INTO appointment_ratings (
          appointment_id, client_id, staff_id, service_id, rating, comment, is_public
        )
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        ON CONFLICT (appointment_id) DO UPDATE
        SET rating = EXCLUDED.rating,
            comment = EXCLUDED.comment,
            is_public = TRUE
      `, [
        appointmentResult.rows[0].appointment_id,
        clientId,
        staffId,
        service.service_id,
        testimonial.rating,
        testimonial.comment,
      ]);
    }
  });

  console.log(`Seeded ${testimonials.length} demo testimonials. Remove the demo records before production use.`);
}

seedDemoTestimonials()
  .catch((error) => {
    console.error('Could not seed demo testimonials:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
