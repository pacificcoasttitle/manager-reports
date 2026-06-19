require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['1. charge_description column metadata',
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name='revenue_line_items' AND column_name='charge_description';`],
  ['2. ESC lines: populated vs missing description (May 2026)',
    `SELECT
       COUNT(*) AS total_esc_lines,
       COUNT(*) FILTER (WHERE charge_description IS NOT NULL AND charge_description <> '') AS has_description,
       COUNT(*) FILTER (WHERE charge_description IS NULL OR charge_description = '') AS missing_description
     FROM revenue_line_items
     WHERE fetch_month='2026-05' AND bill_code='ESC';`],
  ['3. Distinct ESC charge_descriptions in May 2026 (sorted by $)',
    `SELECT
       COALESCE(NULLIF(charge_description, ''), '(empty)') AS charge_description,
       COUNT(*) AS line_count,
       ROUND(SUM(sum_amount)::numeric,2) AS total_amount,
       ROUND(AVG(sum_amount)::numeric,2) AS avg_amount,
       ROUND(MIN(sum_amount)::numeric,2) AS min_amount,
       ROUND(MAX(sum_amount)::numeric,2) AS max_amount
     FROM revenue_line_items
     WHERE fetch_month='2026-05' AND bill_code='ESC'
     GROUP BY charge_description
     ORDER BY total_amount DESC;`],
  ['4. ESC descriptions across Jan-May 2026 (consistency check)',
    `SELECT
       fetch_month,
       COALESCE(NULLIF(charge_description, ''), '(empty)') AS charge_description,
       COUNT(*) AS line_count,
       ROUND(SUM(sum_amount)::numeric,2) AS total_amount
     FROM revenue_line_items
     WHERE bill_code='ESC' AND fetch_month >= '2026-01'
     GROUP BY fetch_month, charge_description
     ORDER BY fetch_month, total_amount DESC;`],
  ['5. May 2026: revenue per escrow officer x description',
    `SELECT
       os.escrow_officer,
       COALESCE(NULLIF(rli.charge_description, ''), '(empty)') AS charge_description,
       COUNT(*) AS line_count,
       ROUND(SUM(rli.sum_amount)::numeric,2) AS revenue
     FROM revenue_line_items rli
     JOIN order_summary os
       ON rli.file_number = os.file_number AND os.fetch_month = rli.fetch_month
     WHERE rli.fetch_month='2026-05'
       AND rli.bill_code='ESC'
       AND os.escrow_officer IS NOT NULL AND os.escrow_officer <> ''
     GROUP BY os.escrow_officer, rli.charge_description
     ORDER BY os.escrow_officer, revenue DESC;`],
  ['6. ALL distinct ESC descriptions across all months',
    `SELECT DISTINCT
       COALESCE(NULLIF(charge_description, ''), '(empty)') AS charge_description
     FROM revenue_line_items
     WHERE bill_code='ESC'
     ORDER BY 1;`],
  ['7. Reconciliation: line_items vs order_summary for May',
    `WITH line_total AS (
       SELECT ROUND(SUM(sum_amount)::numeric,2) AS total
       FROM revenue_line_items WHERE fetch_month='2026-05' AND bill_code='ESC'),
     summary_total AS (
       SELECT ROUND(SUM(escrow_revenue)::numeric,2) AS total
       FROM order_summary WHERE fetch_month='2026-05')
     SELECT l.total AS line_items_total, s.total AS order_summary_total,
            ROUND((l.total - s.total)::numeric,2) AS difference
     FROM line_total l, summary_total s;`],
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
