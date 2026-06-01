require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  await pool.query(
    "INSERT INTO app_settings (key, value) VALUES ('officer_emails_enabled', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'"
  );
  await pool.query(
    "INSERT INTO app_settings (key, value) VALUES ('officer_emails_time', '05:00') ON CONFLICT (key) DO UPDATE SET value = '05:00'"
  );
  const { rows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('officer_emails_enabled', 'officer_emails_time') ORDER BY key"
  );
  console.table(rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
