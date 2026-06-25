require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  const label = process.argv[2] || 'snapshot';
  console.log(`=== ${label}: reconciled figures ===`);
  console.table((await pool.query(`
    SELECT
      ROUND(SUM(total_revenue)::numeric,2) as total_revenue,
      ROUND(SUM(escrow_revenue)::numeric,2) as escrow_revenue,
      ROUND(SUM(commissionable_escrow)::numeric,2) as rep_commissionable,
      ROUND(SUM(officer_commissionable_escrow)::numeric,2) as officer_commissionable,
      ROUND(SUM(title_revenue + underwriter_revenue)::numeric,2) as title_uw,
      ROUND(SUM(tsg_revenue)::numeric,2) as tsg,
      COUNT(*) as total_orders
    FROM order_summary WHERE fetch_month IN ('2026-06','2026-05','2026-04')`)).rows);

  console.log(`=== ${label}: reconciliation status ===`);
  console.table((await pool.query(`
    SELECT fetch_month,
      CASE WHEN ABS(SUM(total_revenue) - (SUM(title_revenue+underwriter_revenue)+SUM(escrow_revenue)+SUM(tsg_revenue))) < 0.01
           THEN 'RECONCILED' ELSE 'BROKEN' END as status
    FROM order_summary WHERE fetch_month >= '2025-08'
    GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
