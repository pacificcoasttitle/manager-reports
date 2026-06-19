require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  const rep = 'Sandra Millar';
  const month = '2026-06';

  console.log('=== Sandra June openings by trans_type AND order_type ===');
  const q1 = await pool.query(`
    SELECT trans_type, order_type, COUNT(*)::int as count
    FROM open_orders
    WHERE sales_rep = $1 AND open_month = $2
    GROUP BY trans_type, order_type
    ORDER BY count DESC
  `, [rep, month]);
  console.table(q1.rows);

  console.log('\n=== trans_type breakdown (null/blank vs named) ===');
  const q2 = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE trans_type IS NULL OR trans_type = '')::int as blank_trans,
      COUNT(*) FILTER (WHERE LOWER(trans_type) = 'purchase')::int as purchase,
      COUNT(*) FILTER (WHERE LOWER(trans_type) = 'refinance')::int as refinance,
      COUNT(*) FILTER (WHERE LOWER(trans_type) NOT IN ('purchase','refinance') AND trans_type IS NOT NULL AND trans_type != '')::int as other_named
    FROM open_orders
    WHERE sales_rep = $1 AND open_month = $2
  `, [rep, month]);
  console.table(q2.rows);

  console.log('\n=== Sandra closings by category ===');
  const q3 = await pool.query(`
    SELECT category, COUNT(*)::int as count
    FROM order_summary
    WHERE sales_rep = $1 AND fetch_month = $2
    GROUP BY category
    ORDER BY count DESC
  `, [rep, month]);
  console.table(q3.rows);

  console.log('\n=== Company-wide June 2026 opens by type ===');
  const q4 = await pool.query(`
    SELECT
      CASE WHEN LOWER(trans_type)='purchase' THEN 'purchase'
           WHEN LOWER(trans_type)='refinance' THEN 'refinance'
           ELSE 'other' END as type,
      COUNT(*)::int as count
    FROM open_orders
    WHERE open_month = $1
    GROUP BY type
    ORDER BY count DESC
  `, [month]);
  console.table(q4.rows);

  console.log('\n=== DISTINCT trans_type values for Sandra June (other bucket) ===');
  const q5 = await pool.query(`
    SELECT trans_type, COUNT(*)::int as count
    FROM open_orders
    WHERE sales_rep = $1 AND open_month = $2
      AND LOWER(trans_type) NOT IN ('purchase', 'refinance')
    GROUP BY trans_type
    ORDER BY count DESC
  `, [rep, month]);
  console.table(q5.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
