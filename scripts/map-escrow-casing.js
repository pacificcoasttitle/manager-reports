require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== 1. Exact stored casing(s) for escrow only ===');
  console.table((await pool.query(`SELECT order_type, COUNT(*)::int n FROM order_summary WHERE LOWER(order_type)='escrow only' GROUP BY order_type`)).rows);

  console.log('\n=== 2. The 46 orders: totals ===');
  console.table((await pool.query(`
    SELECT COUNT(*)::int orders,
      ROUND(SUM(escrow_revenue)::numeric,2) full_escrow,
      ROUND(SUM(commissionable_escrow)::numeric,2) commissionable,
      ROUND(SUM(total_revenue)::numeric,2) total_revenue
    FROM order_summary WHERE LOWER(order_type)='escrow only'`)).rows);

  console.log('\n=== 3. By month ===');
  console.table((await pool.query(`
    SELECT fetch_month, COUNT(*)::int n, ROUND(SUM(escrow_revenue)::numeric,2) escrow, ROUND(SUM(commissionable_escrow)::numeric,2) comm
    FROM order_summary WHERE LOWER(order_type)='escrow only'
    GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  console.log('\n=== 4. Scope comparison (capital-O vs lowercase vs case-insensitive) by month ===');
  console.table((await pool.query(`
    SELECT fetch_month,
      ROUND(SUM(escrow_revenue) FILTER (WHERE order_type IN ('Title & Escrow','Escrow Only'))::numeric,2) capital_O,
      ROUND(SUM(escrow_revenue) FILTER (WHERE order_type IN ('Title & Escrow','Escrow only'))::numeric,2) lowercase_o,
      ROUND(SUM(escrow_revenue) FILTER (WHERE LOWER(order_type) IN ('title & escrow','escrow only'))::numeric,2) case_insensitive,
      ROUND(SUM(escrow_revenue) FILTER (WHERE escrow_revenue>0)::numeric,2) any_escrow_gt0
    FROM order_summary WHERE fetch_month >= '2025-08'
    GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  console.log('\n=== 4b. Reconciliation: grand total (all orders) vs Escrow Production scope ===');
  console.table((await pool.query(`
    SELECT fetch_month,
      ROUND(SUM(total_revenue)::numeric,2) grand_total,
      ROUND(SUM(escrow_revenue)::numeric,2) recon_escrow_all,
      ROUND(SUM(escrow_revenue) FILTER (WHERE escrow_revenue>0 AND order_type IN ('Title & Escrow','Escrow Only'))::numeric,2) escrow_prod_report_scope,
      ROUND(SUM(escrow_revenue) FILTER (WHERE escrow_revenue>0 AND order_type='Escrow only')::numeric,2) dropped_by_report
    FROM order_summary WHERE fetch_month='2026-06'
    GROUP BY fetch_month`)).rows);

  console.log('\n=== 4c. Are there Escrow-only files with escrow_revenue>0 that the report scope misses, historically? ===');
  console.table((await pool.query(`
    SELECT fetch_month, COUNT(*)::int dropped_orders, ROUND(SUM(escrow_revenue)::numeric,2) dropped_escrow
    FROM order_summary
    WHERE order_type='Escrow only' AND escrow_revenue>0
    GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
