require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  const upd = await pool.query(
    "UPDATE rep_manager_assignments SET sales_rep = 'Glendale  House Account' WHERE sales_rep = 'Glendale House Account'"
  );
  console.log('Glendale assignment fixed (single->double space). Rows:', upd.rowCount, '\n');

  console.log('=== Step 3a (re-check): Assigned reps NOT in order_summary ===');
  const { rows: missing } = await pool.query(`
    SELECT rma.sales_rep, rma.manager_name
    FROM rep_manager_assignments rma
    LEFT JOIN (SELECT DISTINCT sales_rep FROM order_summary) os ON rma.sales_rep = os.sales_rep
    WHERE os.sales_rep IS NULL
    ORDER BY rma.manager_name, rma.sales_rep`);
  console.table(missing);

  // Confirm the ones flagged still appear in open_orders (legit openings-only reps)
  const { rows: inOpens } = await pool.query(`
    SELECT DISTINCT sales_rep FROM open_orders
    WHERE sales_rep IN (SELECT rma.sales_rep FROM rep_manager_assignments rma
      LEFT JOIN (SELECT DISTINCT sales_rep FROM order_summary) os ON rma.sales_rep = os.sales_rep
      WHERE os.sales_rep IS NULL)`);
  console.log('Of those, present in open_orders (openings-only, valid):', inOpens.map(r => r.sales_rep));

  console.log('\n=== Step 4 (re-check): Team totals (MTD latest) ===');
  const { rows: totals } = await pool.query(`
    SELECT rma.manager_name,
      COUNT(DISTINCT rma.sales_rep) as reps_assigned,
      COUNT(os.id) as mtd_orders,
      ROUND(SUM(os.total_revenue)::numeric, 2) as mtd_revenue
    FROM rep_manager_assignments rma
    LEFT JOIN order_summary os ON rma.sales_rep = os.sales_rep
      AND os.fetch_month = (SELECT MAX(fetch_month) FROM order_summary)
    GROUP BY rma.manager_name
    ORDER BY mtd_revenue DESC NULLS LAST`);
  console.table(totals);

  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
