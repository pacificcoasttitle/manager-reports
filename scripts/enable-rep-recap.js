require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  await pool.query(`
    INSERT INTO app_settings (key, value) VALUES ('rep_recap_emails_enabled', 'true')
    ON CONFLICT (key) DO UPDATE SET value = 'true'`);
  const { rows } = await pool.query("SELECT key, value FROM app_settings WHERE key = 'rep_recap_emails_enabled'");
  console.table(rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
