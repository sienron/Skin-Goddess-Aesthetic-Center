const db = require('../db');

async function migrate() {
  await db.query(`
    UPDATE homepage_content
    SET title = 'skingoddess456@gmail.com'
    WHERE content_key = 'contact_email'
      AND LOWER(BTRIM(title)) = 'info@skingoddess.ph'
  `);
  await db.query(`
    UPDATE homepage_content
    SET body = 'Skin Goddess Aesthetic Center is located in Imus, Cavite, and offers non-surgical aesthetic treatments tailored to individual needs.'
    WHERE content_key = 'about_story'
      AND body LIKE '%Las Piñas, Metro Manila%'
  `);
  await db.query(`
    UPDATE homepage_content
    SET body = 'Mon – Sun · 9:00 AM – 6:00 PM'
    WHERE content_key = 'contact_phone'
      AND body = 'Mon – Sat · 9:00 AM – 6:00 PM'
  `);
  await db.query(`
    UPDATE homepage_content
    SET body = 'Work Hours: 09:00 AM – 06:00 PM from Monday to Sunday'
    WHERE content_key = 'experience'
      AND body = 'Work Hours: 09:00 AM – 06:00 PM from Monday to Saturday'
  `);
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Clinic public details are up to date.'))
    .catch((error) => {
      console.error('Clinic public-details migration failed.', error);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
