require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  const r = await pool.query(`SELECT file_number, sales_rep, order_type, fetch_month, ROUND(commissionable_escrow::numeric,2) comm FROM order_summary WHERE file_number IN ('20014431-OCT','20002643-PRV','20009016-OCT','20015515-OCT') ORDER BY fetch_month`);
  console.table(r.rows);
  const d = await pool.query(`SELECT DISTINCT order_type FROM order_summary WHERE commissionable_escrow>0 ORDER BY order_type`);
  console.log('order_types with commissionable>0:');
  console.table(d.rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
