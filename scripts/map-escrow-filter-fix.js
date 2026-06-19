require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== Step 2: revenue_scoped == recon_bar every month? (gap must be 0) ===');
  console.table((await pool.query(`
    SELECT fetch_month,
      ROUND(SUM(escrow_revenue) FILTER (WHERE escrow_revenue > 0)::numeric,2) revenue_scoped,
      ROUND(SUM(escrow_revenue)::numeric,2) recon_bar,
      ROUND((SUM(escrow_revenue) - SUM(escrow_revenue) FILTER (WHERE escrow_revenue > 0))::numeric,2) gap
    FROM order_summary WHERE fetch_month >= '2025-08'
    GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  console.log('\n=== Step 2b: current capital-O vs casing-fixed vs revenue-scoped (2026-03) ===');
  console.table((await pool.query(`
    SELECT '2026-03' as mth,
      ROUND(SUM(escrow_revenue) FILTER (WHERE order_type IN ('Title & Escrow','Escrow Only'))::numeric,2) current_capital_O,
      ROUND(SUM(escrow_revenue) FILTER (WHERE LOWER(order_type) IN ('title & escrow','escrow only'))::numeric,2) casing_fixed,
      ROUND(SUM(escrow_revenue) FILTER (WHERE escrow_revenue > 0)::numeric,2) revenue_scoped,
      ROUND(SUM(escrow_revenue)::numeric,2) recon_bar
    FROM order_summary WHERE fetch_month='2026-03'`)).rows);

  console.log('\n=== Step 3: commissionable — current scope vs revenue-scoped vs all (all-time Aug 2025+) ===');
  console.table((await pool.query(`
    SELECT ROUND(SUM(commissionable_escrow) FILTER (WHERE order_type IN ('Title & Escrow','Escrow Only'))::numeric,2) current_scope,
      ROUND(SUM(commissionable_escrow) FILTER (WHERE escrow_revenue > 0)::numeric,2) revenue_scoped,
      ROUND(SUM(commissionable_escrow)::numeric,2) all_commissionable
    FROM order_summary WHERE fetch_month >= '2025-08'`)).rows);

  console.log('\n=== Step 4: open_orders casing ===');
  console.table((await pool.query(`SELECT order_type, COUNT(*)::int n FROM open_orders WHERE LOWER(order_type)='escrow only' GROUP BY order_type`)).rows);
  console.log('escrow-only OPENS dropped by capital-O (2026-03):');
  console.table((await pool.query(`
    SELECT COUNT(*) FILTER (WHERE order_type IN ('Title & Escrow','Escrow Only'))::int capital_O_opens,
      COUNT(*) FILTER (WHERE LOWER(order_type) IN ('title & escrow','escrow only'))::int casing_fixed_opens
    FROM open_orders WHERE open_month='2026-03'`)).rows);
  console.log('open_orders distinct order_type values:');
  console.table((await pool.query(`SELECT order_type, COUNT(*)::int n FROM open_orders GROUP BY order_type ORDER BY n DESC`)).rows);

  console.log('\n=== Step 5: every order_type/trans_type with escrow_revenue>0 (edge-case review) ===');
  console.table((await pool.query(`
    SELECT order_type, trans_type, COUNT(*)::int n, ROUND(SUM(escrow_revenue)::numeric,2) escrow
    FROM order_summary WHERE escrow_revenue > 0
    GROUP BY order_type, trans_type ORDER BY escrow DESC`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
