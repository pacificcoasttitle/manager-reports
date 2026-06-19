require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== Orders where commissionable_escrow > escrow_revenue (Apr 2025+) ===');
  const a = await pool.query(`
    SELECT fetch_month, file_number, order_type, sales_rep,
      ROUND(escrow_revenue::numeric,2) full_esc,
      ROUND(commissionable_escrow::numeric,2) comm_esc,
      ROUND((commissionable_escrow - escrow_revenue)::numeric,2) overage
    FROM order_summary
    WHERE fetch_month >= '2025-04' AND commissionable_escrow > escrow_revenue + 0.01
    ORDER BY overage DESC LIMIT 25
  `);
  console.table(a.rows);
  const c = await pool.query(`
    SELECT COUNT(*)::int n, ROUND(SUM(commissionable_escrow - escrow_revenue)::numeric,2) total_overage
    FROM order_summary WHERE fetch_month >= '2025-04' AND commissionable_escrow > escrow_revenue + 0.01
  `);
  console.table(c.rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
