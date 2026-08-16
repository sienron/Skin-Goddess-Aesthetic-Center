// setup-db.js
// Isang beses lang natin 'to papatakbuhin para gawin ang mga tables
// na kailangan ng users at otp_codes. Pwede nang i-delete 'to pagkatapos.

const db = require('../db');

async function setupTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        date_of_birth DATE,
        gender VARCHAR(50),
        civil_status VARCHAR(50),
        contact_number VARCHAR(50),
        home_address TEXT,
        allergies TEXT,
        medical_conditions TEXT,
        email_verified BOOLEAN DEFAULT FALSE,
        role VARCHAR(50) DEFAULT 'client',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Nagawa na ang users table.');

    await db.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        otp_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id),
        code VARCHAR(10) NOT NULL,
        purpose VARCHAR(50) NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Nagawa na ang otp_codes table.');

    console.log("Tapos na! Puwede mo nang i-delete ang setup-db.js na 'to.");
  } catch (error) {
    console.log('May error sa setup:', error);
  }
  process.exit();
}

setupTables();