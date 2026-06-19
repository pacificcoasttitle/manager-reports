require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== 1. Escrow>0 on NON-escrow order types, by order/trans type ===');
  console.table((await pool.query(`
    SELECT order_type, trans_type, COUNT(*)::int orders,
      ROUND(SUM(escrow_revenue)::numeric,2) escrow_rev,
      ROUND(SUM(commissionable_escrow)::numeric,2) commissionable
    FROM order_summary
    WHERE escrow_revenue > 0 AND LOWER(order_type) NOT IN ('title & escrow','escrow only')
    GROUP BY order_type, trans_type ORDER BY escrow_rev DESC`)).rows);

  console.log('\n=== 2. Example orders ===');
  console.table((await pool.query(`
    SELECT file_number, fetch_month, order_type, trans_type,
      ROUND(escrow_revenue::numeric,2) escrow,
      ROUND(title_revenue::numeric,2) title,
      ROUND(total_revenue::numeric,2) total
    FROM order_summary
    WHERE escrow_revenue > 0 AND LOWER(order_type) NOT IN ('title & escrow','escrow only')
    ORDER BY escrow_revenue DESC LIMIT 20`)).rows);

  console.log('\n=== 3. ESC line items on those orders ===');
  console.table((await pool.query(`
    WITH odd AS (
      SELECT file_number, fetch_month FROM order_summary
      WHERE escrow_revenue > 0 AND LOWER(order_type) NOT IN ('title & escrow','escrow only')
    )
    SELECT o.file_number, os.order_type, rli.charge_description, ROUND(rli.sum_amount::numeric,2) amount
    FROM odd o
    JOIN order_summary os ON o.file_number=os.file_number AND o.fetch_month=os.fetch_month
    JOIN revenue_line_items rli ON rli.file_number=o.file_number AND rli.fetch_month=o.fetch_month
    WHERE rli.bill_code='ESC'
    ORDER BY o.file_number, rli.sum_amount DESC`)).rows);

  console.log('\n=== 4. Total magnitude by month ===');
  console.table((await pool.query(`
    SELECT fetch_month, COUNT(*)::int odd_orders, ROUND(SUM(escrow_revenue)::numeric,2) escrow_on_nonescrow_types
    FROM order_summary
    WHERE escrow_revenue > 0 AND LOWER(order_type) NOT IN ('title & escrow','escrow only')
    GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  console.log('\n=== 4b. Grand total magnitude all-time ===');
  console.table((await pool.query(`
    SELECT COUNT(*)::int orders, ROUND(SUM(escrow_revenue)::numeric,2) total_escrow_on_nonescrow,
      ROUND(SUM(commissionable_escrow)::numeric,2) total_comm
    FROM order_summary
    WHERE escrow_revenue > 0 AND LOWER(order_type) NOT IN ('title & escrow','escrow only')`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
