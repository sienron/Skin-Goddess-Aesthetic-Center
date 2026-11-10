const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

async function migrate() {
  await db.transaction((client) => client.query(fs.readFileSync(path.join(__dirname, '050-clinic-management.sql'), 'utf8')));
}
if (require.main === module) {
  migrate().then(() => console.log('Clinic management migration completed.'))
    .catch((error) => { console.error('Clinic management migration failed:', error.message); process.exitCode = 1; })
    .finally(() => db.pool.end());
}
module.exports = { migrate };
