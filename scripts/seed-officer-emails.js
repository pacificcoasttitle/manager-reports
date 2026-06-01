require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS officer_email_recipients (
      id SERIAL PRIMARY KEY,
      officer_name VARCHAR(150) NOT NULL UNIQUE,
      email VARCHAR(200) NOT NULL,
      officer_type VARCHAR(20) DEFAULT 'title',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

  await pool.query(`
    INSERT INTO officer_email_recipients (officer_name, email, officer_type) VALUES
      ('Jim Jean', 'PLACEHOLDER', 'title'),
      ('Clive Virata', 'PLACEHOLDER', 'title'),
      ('Eddie LasMarias', 'PLACEHOLDER', 'title'),
      ('Rachel Barcena', 'PLACEHOLDER', 'title'),
      ('Susan Dana', 'PLACEHOLDER', 'title')
    ON CONFLICT (officer_name) DO NOTHING`);

  // Seed real emails (DB spelling: "Eddie LasMarias", no space)
  const updates = [
    ['Clive Virata', 'cvirata@pct.com'],
    ['Eddie LasMarias', 'elasmarias@pct.com'],
    ['Rachel Barcena', 'rbarcena@pct.com'],
    ['Jim Jean', 'jjean@pct.com'],
  ];
  for (const [name, email] of updates) {
    await pool.query('UPDATE officer_email_recipients SET email = $2 WHERE officer_name = $1', [name, email]);
  }
  // Susan Dana is TSG, not title production — inactive for title emails
  await pool.query("UPDATE officer_email_recipients SET is_active = false WHERE officer_name = 'Susan Dana'");

  const { rows } = await pool.query(
    'SELECT officer_name, email, officer_type, is_active FROM officer_email_recipients ORDER BY officer_name'
  );
  console.table(rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
