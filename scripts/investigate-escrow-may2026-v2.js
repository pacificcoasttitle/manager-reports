require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['2. Summary vs raw line items',
    `WITH summary AS (SELECT SUM(escrow_revenue) AS t FROM order_summary WHERE fetch_month='2026-05'),
          lines   AS (SELECT SUM(sum_amount)    AS t FROM revenue_line_items WHERE fetch_month='2026-05' AND bill_code='ESC')
     SELECT ROUND(s.t::numeric,2) AS os_escrow,
            ROUND(l.t::numeric,2) AS li_escrow,
            ROUND((s.t-l.t)::numeric,2) AS diff
     FROM summary s, lines l;`],
  ['4. ESC line items for top 5 escrow orders',
    `WITH top_orders AS (
       SELECT file_number FROM order_summary
       WHERE fetch_month='2026-05' AND escrow_revenue>0
       ORDER BY escrow_revenue DESC LIMIT 5)
     SELECT rli.file_number, rli.bill_code, rli.bill_code_category,
            ROUND(rli.sum_amount::numeric,2) AS amt, rli.charge_description
     FROM revenue_line_items rli JOIN top_orders USING (file_number)
     WHERE rli.fetch_month='2026-05' AND rli.bill_code='ESC'
     ORDER BY rli.file_number, rli.sum_amount DESC;`],
  ['5. ALL line items for top 5 escrow orders',
    `WITH top_orders AS (
       SELECT file_number FROM order_summary
       WHERE fetch_month='2026-05' AND escrow_revenue>0
       ORDER BY escrow_revenue DESC LIMIT 5)
     SELECT rli.file_number, rli.bill_code, rli.bill_code_category,
            ROUND(rli.sum_amount::numeric,2) AS amt, rli.charge_description
     FROM revenue_line_items rli JOIN top_orders USING (file_number)
     WHERE rli.fetch_month='2026-05'
     ORDER BY rli.file_number, rli.sum_amount DESC;`],
  ['6. Duplicate ESC line items per order',
    `SELECT file_number, COUNT(*) AS esc_lines, ROUND(SUM(sum_amount)::numeric,2) AS total_esc
     FROM revenue_line_items WHERE fetch_month='2026-05' AND bill_code='ESC'
     GROUP BY file_number HAVING COUNT(*)>1
     ORDER BY esc_lines DESC LIMIT 20;`],
  ['7. ESC charge_description distribution',
    `SELECT charge_description, COUNT(*) AS cnt,
            ROUND(SUM(sum_amount)::numeric,2) AS total,
            ROUND(MAX(sum_amount)::numeric,2) AS max_amt
     FROM revenue_line_items WHERE fetch_month='2026-05' AND bill_code='ESC'
     GROUP BY charge_description ORDER BY total DESC LIMIT 30;`],
  ['8. ESC items matching withholding/trust/hold/refund/593/firpta',
    `SELECT file_number, charge_description, ROUND(sum_amount::numeric,2) AS amt
     FROM revenue_line_items WHERE fetch_month='2026-05' AND bill_code='ESC'
       AND (charge_description ILIKE '%withholding%' OR charge_description ILIKE '%593%'
            OR charge_description ILIKE '%firpta%' OR charge_description ILIKE '%refund%'
            OR charge_description ILIKE '%hold%' OR charge_description ILIKE '%trust%')
     ORDER BY amt DESC;`],
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const [name, sql] of Q) {
    console.log('\n=== ' + name + ' ===');
    try {
      const r = await c.query(sql);
      if (!r.rows.length) console.log('(no rows)');
      else console.table(r.rows);
    } catch (e) { console.log('ERROR:', e.message); }
  }
  await c.end();
})();
