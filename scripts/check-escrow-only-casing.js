require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== Distinct order_type values + counts (all time) ===');
  const a = await pool.query(`SELECT order_type, COUNT(*)::int n FROM order_summary GROUP BY order_type ORDER BY n DESC`);
  console.table(a.rows);

  console.log('\n=== Escrow only files: how many, how much commissionable + escrow_revenue dropped by the casing bug ===');
  const b = await pool.query(`
    SELECT fetch_month,
      COUNT(*)::int escrow_only_orders,
      ROUND(SUM(commissionable_escrow)::numeric,2) comm_escrow_dropped,
      ROUND(SUM(escrow_revenue)::numeric,2) full_escrow
    FROM order_summary
    WHERE order_type = 'Escrow only' AND commissionable_escrow > 0
    GROUP BY fetch_month ORDER BY fetch_month DESC LIMIT 15
  `);
  console.table(b.rows);

  console.log('\n=== June 2026 reps affected (Escrow only files with commissionable) ===');
  const c = await pool.query(`
    SELECT sales_rep, COUNT(*)::int n, ROUND(SUM(commissionable_escrow)::numeric,2) comm
    FROM order_summary
    WHERE order_type='Escrow only' AND fetch_month='2026-06' AND commissionable_escrow>0
    GROUP BY sales_rep ORDER BY comm DESC
  `);
  console.log(c.rows.length ? '' : '(none in June)');
  console.table(c.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
