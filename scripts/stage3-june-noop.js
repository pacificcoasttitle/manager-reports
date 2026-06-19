require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== June 2026: old filter vs new filter (must be identical = our change is a no-op for June) ===');
  console.table((await pool.query(`
    SELECT
      ROUND(SUM(CASE WHEN order_type IN ('Title & Escrow','Escrow Only') THEN commissionable_escrow ELSE 0 END)::numeric,2) old_filter,
      ROUND(SUM(CASE WHEN escrow_revenue > 0 THEN commissionable_escrow ELSE 0 END)::numeric,2) new_filter,
      ROUND((SUM(CASE WHEN escrow_revenue > 0 THEN commissionable_escrow ELSE 0 END) - SUM(CASE WHEN order_type IN ('Title & Escrow','Escrow Only') THEN commissionable_escrow ELSE 0 END))::numeric,2) june_delta
    FROM order_summary WHERE fetch_month='2026-06'`)).rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
