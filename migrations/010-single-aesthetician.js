const db = require('../db');

async function migrate() {
  try {
    const result = await db.query(
      `DELETE FROM users
       WHERE LOWER(email) = LOWER($1)
         AND role = 'aesthetician'
       RETURNING user_id`,
      ['loidadeguzman123@gmail.com']
    );

    if (result.rows.length > 0) {
      console.log('Removed the retired aesthetician account.');
    } else {
      console.log('No retired aesthetician account to remove.');
    }
  } catch (error) {
    if (error.code === '23503') {
      console.error('Could not remove the retired aesthetician account because records still reference it. Preserve or reassign those records before retrying.');
    } else {
      console.error('Single-aesthetician migration failed:', error.message);
    }
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());