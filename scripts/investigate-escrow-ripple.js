require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  console.log('=== PART 2: Monthly gap (full vs commissionable), Apr 2025+ ===');
  const p2 = await pool.query(`
    SELECT fetch_month,
      ROUND(SUM(escrow_revenue)::numeric,2) full_escrow,
      ROUND(SUM(commissionable_escrow)::numeric,2) commissionable_escrow,
      ROUND(SUM(escrow_revenue - commissionable_escrow)::numeric,2) pass_through_excluded
    FROM order_summary WHERE fetch_month >= '2025-04'
    GROUP BY fetch_month ORDER BY fetch_month
  `);
  console.table(p2.rows);

  console.log('\n=== PART 3: June 2026 reconciliation components ===');
  const p3 = await pool.query(`
    SELECT ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) title_officer,
      ROUND(SUM(escrow_revenue)::numeric,2) escrow_full,
      ROUND(SUM(commissionable_escrow)::numeric,2) escrow_commissionable,
      ROUND(SUM(tsg_revenue)::numeric,2) tsg,
      ROUND(SUM(total_revenue)::numeric,2) grand_total,
      ROUND(SUM(title_revenue+underwriter_revenue+commissionable_escrow+tsg_revenue)::numeric,2) grand_total_if_commissionable
    FROM order_summary WHERE fetch_month='2026-06'
  `);
  console.table(p3.rows);

  console.log('\n=== PART 5: total_revenue vs passthrough-removed (Apr 2026+) ===');
  const p5 = await pool.query(`
    SELECT fetch_month,
      ROUND(SUM(total_revenue)::numeric,2) our_total,
      ROUND(SUM(total_revenue - (escrow_revenue - commissionable_escrow))::numeric,2) total_if_passthrough_removed,
      ROUND(SUM(escrow_revenue - commissionable_escrow)::numeric,2) gap
    FROM order_summary WHERE fetch_month >= '2026-04'
    GROUP BY fetch_month ORDER BY fetch_month
  `);
  console.table(p5.rows);

  console.log('\n=== PART 2b: Total all-time pass-through excluded (Apr 2025+) ===');
  const p2b = await pool.query(`
    SELECT ROUND(SUM(escrow_revenue)::numeric,2) full_escrow,
      ROUND(SUM(commissionable_escrow)::numeric,2) commissionable,
      ROUND(SUM(escrow_revenue - commissionable_escrow)::numeric,2) total_passthrough,
      ROUND(SUM(total_revenue)::numeric,2) grand_total,
      ROUND((SUM(escrow_revenue - commissionable_escrow) / NULLIF(SUM(total_revenue),0) * 100)::numeric,3) passthrough_pct_of_total
    FROM order_summary WHERE fetch_month >= '2025-04'
  `);
  console.table(p2b.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
