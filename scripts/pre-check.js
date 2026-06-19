require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  const x = (await pool.query(`SELECT ROUND(SUM(total_revenue)::numeric,2) tr, ROUND(SUM(escrow_revenue)::numeric,2) er FROM order_summary WHERE fetch_month='2026-06'`)).rows[0];
  console.log('PRE total_revenue:', x.tr, 'escrow_revenue:', x.er);
  await pool.end();
})();
