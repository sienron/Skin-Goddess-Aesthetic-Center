const fs = require('node:fs');
const path = require('node:path');

async function migrate(client) {
  await client.query(fs.readFileSync(path.join(__dirname, '052-historical-appointment-records.sql'), 'utf8'));
}

if (require.main === module) {
  const db = require('../db');
  db.transaction(migrate)
    .then(() => console.log('Historical appointment record support is ready.'))
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
