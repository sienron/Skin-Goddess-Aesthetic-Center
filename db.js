// db.js
// Ito yung file na gumagawa ng koneksyon papunta sa PostgreSQL database natin.
// Ginagamit natin ito sa ibang files tuwing kailangan nating mag-SELECT, INSERT, UPDATE, atbp.

require('dotenv').config(); // binabasa nito yung laman ng .env file (DB_USER, DB_PASSWORD, atbp.)

const { Pool } = require('pg');
// Ang "Pool" ay parang isang grupo ng mga bukas na koneksyon papunta sa database.
// Sa halip na gumawa ng bagong koneksyon kada query (mabagal 'yun), ang Pool ay
// nag-re-reuse ng mga koneksyon, kaya mas mabilis.

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});
// Ito yung "settings" ng koneksyon natin — kinukuha lahat mula sa .env file,
// para hindi natin kailangang i-type nang diretso yung password sa code

// Simpleng test: pag na-start ang server, susubukan nitong kumonekta agad,
// tapos sasabihin sa atin sa terminal kung successful o hindi.
pool.connect((error, client, releaseConnection) => {
  if (error) {
    console.log('Not Connected to Database:', error.message);
    return;
  }
  console.log('Connected to Database:', process.env.DB_NAME);
  releaseConnection(); // ibinabalik yung koneksyon na 'to sa Pool para pwede ulit gamitin
});

// Ito yung ie-export natin papunta sa ibang files. Sa halip na i-expose yung
// buong Pool, ginagawa lang nating isang simpleng function na "query" —
// mas malinis, at ito lang naman ang kailangan ng ibang files.
module.exports = {
  query: (sql, values) => pool.query(sql, values),
};