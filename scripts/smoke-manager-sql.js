require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  const { rows: r } = await pool.query(
    "SELECT sales_rep FROM order_summary WHERE sales_rep IS NOT NULL AND TRIM(sales_rep) <> '' GROUP BY sales_rep ORDER BY COUNT(*) DESC LIMIT 2"
  );
  const reps = r.map(x => x.sales_rep);
  console.log('Sample reps:', reps);
  const ym = '2026-05';

  const mtd = await pool.query(
    'SELECT sales_rep, COUNT(*) c, ROUND(SUM(total_revenue)::numeric,2) rev FROM order_summary WHERE sales_rep = ANY($1) AND fetch_month = $2 GROUP BY sales_rep', [reps, ym]);
  const opens = await pool.query(
    "SELECT sales_rep, COUNT(*) c FROM open_orders WHERE sales_rep = ANY($1) AND open_month = $2 AND file_number NOT ILIKE 'test%' GROUP BY sales_rep", [reps, ym]);
  const company = await pool.query('SELECT ROUND(SUM(total_revenue)::numeric,2) c FROM order_summary WHERE fetch_month = $1', [ym]);
  console.log('MTD rows:', mtd.rows);
  console.log('Opens rows:', opens.rows);
  console.log('Company MTD revenue:', company.rows[0].c);
  await pool.end();
})().catch(e => { console.error('SQL ERROR:', e.message); process.exit(1); });
