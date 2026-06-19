require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  const { rows: settings } = await pool.query(`
    SELECT key, value FROM app_settings
    WHERE key IN ('manager_emails_enabled', 'officer_emails_enabled', 'rep_emails_enabled', 'cron_enabled', 'cron_time')
    ORDER BY key`);
  console.log('APP SETTINGS:');
  console.table(settings);

  const { rows: logs } = await pool.query(`
    SELECT import_type, records_imported, success, error_message, triggered_by, started_at
    FROM import_log
    WHERE import_type IN ('manager_emails', 'officer_emails', 'rep_emails')
    ORDER BY started_at DESC LIMIT 15`);
  console.log('\nEMAIL SEND LOG (last 15):');
  if (logs.length) console.table(logs);
  else console.log('  (no rows for manager_emails / officer_emails / rep_emails)');

  const { rows: mgrLog } = await pool.query(`
    SELECT * FROM import_log WHERE import_type = 'manager_emails' ORDER BY started_at DESC LIMIT 10`);
  console.log('\nMANAGER EMAILS LOG (all):');
  if (mgrLog.length) console.table(mgrLog);
  else console.log('  never logged — no manager_emails sends in import_log');

  const { rows: managers } = await pool.query(
    "SELECT manager_name, email, is_active FROM sales_managers ORDER BY manager_name");
  console.log('\nSALES MANAGERS:');
  console.table(managers);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
