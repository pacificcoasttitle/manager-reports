require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  const { rows: maxRows } = await pool.query('SELECT MAX(fetch_month) as m FROM order_summary');
  console.log('MAX(fetch_month):', maxRows[0].m);

  // Email uses yesterday's month. Today is run-time; compute the same way the lib does.
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const y = new Date(pacificNow); y.setDate(y.getDate() - 1);
  const ym = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}`;
  console.log('Email MTD month (yesterday):', ym);

  const officers = ['Clive Virata', 'Eddie LasMarias', 'Rachel Barcena', 'Jim Jean'];
  const { rows } = await pool.query(`
    SELECT title_officer,
      COUNT(*) as mtd_orders,
      ROUND(SUM(title_revenue + underwriter_revenue)::numeric, 2) as mtd_revenue
    FROM order_summary
    WHERE fetch_month = $1
      AND (title_revenue + underwriter_revenue) > 0
      AND title_officer = ANY($2)
    GROUP BY title_officer
    ORDER BY mtd_revenue DESC`, [ym, officers]);
  console.table(rows);

  // Confirm no name-spelling misses (any title_officer ILIKE eddie / las marias?)
  const { rows: eddie } = await pool.query(
    "SELECT DISTINCT title_officer FROM order_summary WHERE title_officer ILIKE '%marias%'");
  console.log('Eddie spellings in data:', eddie.map(r => r.title_officer));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
