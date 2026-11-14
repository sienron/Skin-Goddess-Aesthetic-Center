// db.js
// Ito yung file na gumagawa ng koneksyon papunta sa PostgreSQL database natin.
// Ginagamit natin ito sa ibang files tuwing kailangan nating mag-SELECT, INSERT, UPDATE, atbp.

require('dotenv').config(); 

const { Pool } = require('pg');
const { getPostgresSslConfig } = require('./utils/postgresConfig');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  ssl: getPostgresSslConfig()
});
// Ito yung "settings" ng koneksyon natin — kinukuha lahat mula sa .env file,
// para hindi natin kailangang i-type nang diretso yung password sa code

// Ito yung ie-export natin papunta sa ibang files. Sa halip na i-expose yung
// buong Pool, ginagawa lang nating isang simpleng function na "query" —
// mas malinis, at ito lang naman ang kailangan ng ibang files.
module.exports = {
  pool,
  query: (sql, values) => pool.query(sql, values),
  transaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};