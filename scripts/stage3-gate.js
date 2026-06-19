require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== A. Grand total + full escrow by month (must match pre-fix) ===');
  console.table((await pool.query(`
    SELECT fetch_month, ROUND(SUM(total_revenue)::numeric,2) total_revenue, ROUND(SUM(escrow_revenue)::numeric,2) full_escrow
    FROM order_summary WHERE fetch_month >= '2025-08' GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  console.log('\n=== B. Reconciliation status by month ===');
  console.table((await pool.query(`
    SELECT fetch_month,
      CASE WHEN ABS(SUM(total_revenue) - (SUM(title_revenue+underwriter_revenue)+SUM(escrow_revenue)+SUM(tsg_revenue))) < 0.01
           THEN 'RECONCILED' ELSE 'BROKEN' END status
    FROM order_summary WHERE fetch_month >= '2025-08' GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  console.log('\n=== C. Commissionable revenue-scoped vs all ===');
  console.table((await pool.query(`
    SELECT ROUND(SUM(commissionable_escrow) FILTER (WHERE escrow_revenue > 0)::numeric,2) revenue_scoped,
      ROUND(SUM(commissionable_escrow)::numeric,2) all_commissionable
    FROM order_summary WHERE fetch_month >= '2025-08'`)).rows);

  console.log('\n=== G. Escrow Production revenue (should be unchanged) ===');
  console.table((await pool.query(`
    SELECT fetch_month, ROUND(SUM(escrow_revenue) FILTER (WHERE escrow_revenue > 0)::numeric,2) escrow_production_revenue
    FROM order_summary WHERE fetch_month IN ('2026-06','2026-03') GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
