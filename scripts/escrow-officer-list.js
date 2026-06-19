require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== 1. All escrow officers (canonical, all-time commissionable) ===');
  console.table((await pool.query(`
    SELECT escrow_officer,
      COUNT(*)::int total_orders,
      COUNT(*) FILTER (WHERE commissionable_escrow > 0)::int orders_with_comm,
      ROUND(SUM(commissionable_escrow)::numeric,2) all_time_commissionable,
      ROUND(SUM(escrow_revenue)::numeric,2) all_time_full_escrow
    FROM order_summary
    WHERE escrow_officer IS NOT NULL AND escrow_officer != '' AND escrow_revenue > 0
    GROUP BY escrow_officer ORDER BY all_time_commissionable DESC`)).rows);

  console.log('\n=== 2. June 2026 active escrow officers ===');
  console.table((await pool.query(`
    SELECT escrow_officer,
      COUNT(*) FILTER (WHERE commissionable_escrow > 0)::int june_orders,
      ROUND(SUM(commissionable_escrow)::numeric,2) june_commissionable
    FROM order_summary
    WHERE fetch_month='2026-06' AND escrow_officer IS NOT NULL AND escrow_officer != '' AND escrow_revenue > 0
    GROUP BY escrow_officer HAVING SUM(commissionable_escrow) > 0
    ORDER BY june_commissionable DESC`)).rows);

  console.log('\n=== 3. Unmapped escrow revenue (blank/null officer, 2026+) ===');
  console.table((await pool.query(`
    SELECT COUNT(*)::int unmapped_orders, ROUND(SUM(commissionable_escrow)::numeric,2) unmapped_commissionable
    FROM order_summary
    WHERE (escrow_officer IS NULL OR escrow_officer = '') AND commissionable_escrow > 0 AND fetch_month >= '2026-01'`)).rows);

  console.log('\n=== 4. Officer -> branch suffixes ===');
  console.table((await pool.query(`
    SELECT escrow_officer,
      COUNT(DISTINCT SUBSTRING(file_number FROM '[A-Z]+$'))::int branch_count,
      STRING_AGG(DISTINCT SUBSTRING(file_number FROM '[A-Z]+$'), ', ') branches
    FROM order_summary
    WHERE escrow_officer IS NOT NULL AND escrow_officer != '' AND escrow_revenue > 0
    GROUP BY escrow_officer ORDER BY escrow_officer`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
