const db = require('../db');

async function migrate() {
  try {
    const result = await db.query(`
      UPDATE homepage_content
      SET body = $1
      WHERE content_key = 'hero'
        AND page_key = 'home'
        AND body = $2
    `, [
      'Personalized skincare and aesthetic treatments designed around you.',
      'Trusted skincare and aesthetic treatments, tailored to you at Skin-Goddess Aesthetic Center.',
    ]);
    console.log(`Updated ${result.rowCount} default homepage hero description(s).`);
  } catch (error) {
    console.error('Homepage hero copy migration failed.');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

migrate();
