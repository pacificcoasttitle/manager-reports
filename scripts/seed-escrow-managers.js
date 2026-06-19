require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== app_settings columns ===');
  console.table((await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='app_settings' ORDER BY ordinal_position`)).rows);

  console.log('\n=== Part 3: escrow_managers table + seed ===');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS escrow_managers (
      id SERIAL PRIMARY KEY,
      manager_name VARCHAR(150) NOT NULL UNIQUE,
      email VARCHAR(200) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
  await pool.query(`
    INSERT INTO escrow_managers (manager_name, email) VALUES ('Analleli Ayala', 'aayala@pct.com')
    ON CONFLICT (manager_name) DO UPDATE SET email = EXCLUDED.email, is_active = true`);
  console.table((await pool.query(`SELECT manager_name, email, is_active FROM escrow_managers ORDER BY manager_name`)).rows);

  console.log('\n=== Part 5: flags OFF ===');
  await pool.query(`INSERT INTO app_settings (key, value) VALUES ('escrow_officer_emails_enabled', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false'`);
  await pool.query(`INSERT INTO app_settings (key, value) VALUES ('escrow_manager_emails_enabled', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false'`);
  console.table((await pool.query(`SELECT key, value FROM app_settings WHERE key LIKE 'escrow_%_emails_enabled' ORDER BY key`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
