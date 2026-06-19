require('dotenv').config();
const { Client } = require('pg');

// NOTE: revenue_line_items column is `sum_amount`, not `amount`.
const queries = [
  { name: '1. May 2026 escrow revenue sanity check', sql: `
    SELECT 
      COUNT(*) FILTER (WHERE escrow_revenue > 0) as orders_with_escrow,
      ROUND(SUM(escrow_revenue)::numeric, 2) as total_escrow_rev,
      ROUND(AVG(escrow_revenue) FILTER (WHERE escrow_revenue > 0)::numeric, 2) as avg_escrow_per_order,
      ROUND(MAX(escrow_revenue)::numeric, 2) as max_single_order
    FROM order_summary
    WHERE fetch_month = '2026-05';` },
  { name: '2. Summary vs raw line items for May', sql: `
    WITH summary AS (
      SELECT SUM(escrow_revenue) as summary_total 
      FROM order_summary WHERE fetch_month = '2026-05'
    ),
    lines AS (
      SELECT SUM(amount) as line_total 
      FROM revenue_line_items 
      WHERE fetch_month = '2026-05' AND bill_code = 'ESC'
    )
    SELECT 
      ROUND(s.summary_total::numeric, 2) as order_summary_escrow,
      ROUND(l.line_total::numeric, 2) as line_items_escrow,
      ROUND((s.summary_total - l.line_total)::numeric, 2) as difference
    FROM summary s, lines l;` },
  { name: '3. Top 20 highest escrow revenue orders in May', sql: `
    SELECT 
      file_number, order_type, trans_type, category, escrow_officer, title_officer, sales_rep,
      ROUND(escrow_revenue::numeric, 2) as escrow_rev,
      ROUND(total_revenue::numeric, 2) as total_rev
    FROM order_summary
    WHERE fetch_month = '2026-05' AND escrow_revenue > 0
    ORDER BY escrow_revenue DESC LIMIT 20;` },
  { name: '4. ESC line items for top 5 escrow orders', sql: `
    WITH top_orders AS (
      SELECT file_number FROM order_summary 
      WHERE fetch_month = '2026-05' AND escrow_revenue > 0
      ORDER BY escrow_revenue DESC LIMIT 5
    )
    SELECT rli.file_number, rli.bill_code, rli.bill_code_category,
      ROUND(rli.amount::numeric, 2) as amount, rli.charge_description
    FROM revenue_line_items rli
    INNER JOIN top_orders ON rli.file_number = top_orders.file_number
    WHERE rli.fetch_month = '2026-05' AND rli.bill_code = 'ESC'
    ORDER BY rli.file_number, rli.amount DESC;` },
  { name: '5. ALL line items for top 5 escrow orders', sql: `
    WITH top_orders AS (
      SELECT file_number FROM order_summary 
      WHERE fetch_month = '2026-05' AND escrow_revenue > 0
      ORDER BY escrow_revenue DESC LIMIT 5
    )
    SELECT rli.file_number, rli.bill_code, rli.bill_code_category,
      ROUND(rli.amount::numeric, 2) as amount, rli.charge_description
    FROM revenue_line_items rli
    INNER JOIN top_orders ON rli.file_number = top_orders.file_number
    WHERE rli.fetch_month = '2026-05'
    ORDER BY rli.file_number, rli.amount DESC;` },
  { name: '6. Duplicate ESC line items on same order in May', sql: `
    SELECT file_number, COUNT(*) as esc_line_count,
      ROUND(SUM(amount)::numeric, 2) as total_esc
    FROM revenue_line_items
    WHERE fetch_month = '2026-05' AND bill_code = 'ESC'
    GROUP BY file_number HAVING COUNT(*) > 1
    ORDER BY esc_line_count DESC LIMIT 20;` },
  { name: '7. Suspicious charge descriptions in ESC for May', sql: `
    SELECT charge_description, COUNT(*) as count,
      ROUND(SUM(amount)::numeric, 2) as total,
      ROUND(MAX(amount)::numeric, 2) as max_amount
    FROM revenue_line_items
    WHERE fetch_month = '2026-05' AND bill_code = 'ESC'
    GROUP BY charge_description
    ORDER BY total DESC LIMIT 30;` },
  { name: '8. ESC line items that might be withholding/non-revenue', sql: `
    SELECT file_number, charge_description, ROUND(amount::numeric, 2) as amount
    FROM revenue_line_items
    WHERE fetch_month = '2026-05' AND bill_code = 'ESC'
      AND (charge_description ILIKE '%withholding%' 
           OR charge_description ILIKE '%593%'
           OR charge_description ILIKE '%firpta%'
           OR charge_description ILIKE '%refund%'
           OR charge_description ILIKE '%hold%'
           OR charge_description ILIKE '%trust%')
    ORDER BY amount DESC;` },
  { name: '9. Escrow revenue by escrow officer for May', sql: `
    SELECT COALESCE(NULLIF(escrow_officer, ''), '(no officer)') as escrow_officer,
      COUNT(*) as orders,
      ROUND(SUM(escrow_revenue)::numeric, 2) as total_escrow_rev,
      ROUND(AVG(escrow_revenue)::numeric, 2) as avg_per_order,
      ROUND(MAX(escrow_revenue)::numeric, 2) as max_order
    FROM order_summary
    WHERE fetch_month = '2026-05' AND escrow_revenue > 0
    GROUP BY escrow_officer
    ORDER BY total_escrow_rev DESC;` },
  { name: '10. Compare May to prior months', sql: `
    SELECT fetch_month,
      COUNT(*) FILTER (WHERE escrow_revenue > 0) as orders,
      ROUND(SUM(escrow_revenue)::numeric, 2) as total_escrow,
      ROUND(AVG(escrow_revenue) FILTER (WHERE escrow_revenue > 0)::numeric, 2) as avg_per_order
    FROM order_summary
    WHERE fetch_month >= '2026-01'
    GROUP BY fetch_month ORDER BY fetch_month;` },
];

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  for (const q of queries) {
    console.log('\n========================================');
    console.log(q.name);
    console.log('========================================');
    try {
      const res = await client.query(q.sql);
      if (res.rows.length === 0) {
        console.log('(no rows)');
      } else {
        console.table(res.rows);
      }
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
  await client.end();
})();
