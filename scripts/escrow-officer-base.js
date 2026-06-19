require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== 1. Full ESC vocabulary by bucket ===');
  console.table((await pool.query(`
    SELECT charge_description, COUNT(*)::int lines, ROUND(SUM(sum_amount)::numeric,2) total,
      CASE
        WHEN LOWER(charge_description) LIKE '%settlement%' OR LOWER(charge_description) LIKE '%courtesy%'
          OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%'
          THEN '1-REP commissionable'
        WHEN LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%'
          THEN '2-LOAN TIE-IN'
        WHEN LOWER(charge_description) LIKE '%doc%' THEN '3-DOCS'
        ELSE '4-OTHER' END bucket
    FROM revenue_line_items WHERE bill_code='ESC'
    GROUP BY charge_description ORDER BY bucket, total DESC`)).rows);

  console.log('\n=== 2. Loan tie-in + docs descriptions on ESC ===');
  console.table((await pool.query(`
    SELECT charge_description, COUNT(*)::int lines, ROUND(SUM(sum_amount)::numeric,2) total
    FROM revenue_line_items WHERE bill_code='ESC'
      AND (LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%' OR LOWER(charge_description) LIKE '%doc%')
    GROUP BY charge_description ORDER BY total DESC`)).rows);

  console.log('\n=== 3. CRITICAL: where does "doc" live — which bill codes? ===');
  console.table((await pool.query(`
    SELECT bill_code, charge_description, COUNT(*)::int lines, ROUND(SUM(sum_amount)::numeric,2) total
    FROM revenue_line_items WHERE LOWER(charge_description) LIKE '%doc%'
    GROUP BY bill_code, charge_description ORDER BY total DESC`)).rows);

  console.log('\n=== 3b. All distinct bill codes overall (context) ===');
  console.table((await pool.query(`
    SELECT bill_code, COUNT(*)::int lines, ROUND(SUM(sum_amount)::numeric,2) total
    FROM revenue_line_items GROUP BY bill_code ORDER BY total DESC`)).rows);

  console.log('\n=== 4. OTHER bucket (ESC, not settlement/credit/tie-in/docs) ===');
  console.table((await pool.query(`
    SELECT charge_description, COUNT(*)::int lines, ROUND(SUM(sum_amount)::numeric,2) total
    FROM revenue_line_items WHERE bill_code='ESC'
      AND NOT (LOWER(charge_description) LIKE '%settlement%' OR LOWER(charge_description) LIKE '%courtesy%'
        OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%'
        OR LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%'
        OR LOWER(charge_description) LIKE '%doc%')
    GROUP BY charge_description ORDER BY total DESC`)).rows);

  console.log('\n=== 5. Impact: rep_base vs officer_base_est vs full_esc by month (2026+) ===');
  console.table((await pool.query(`
    SELECT fetch_month,
      ROUND(SUM(sum_amount) FILTER (WHERE LOWER(charge_description) LIKE '%settlement%' OR LOWER(charge_description) LIKE '%courtesy%' OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%')::numeric,2) rep_base,
      ROUND(SUM(sum_amount) FILTER (WHERE LOWER(charge_description) LIKE '%settlement%' OR LOWER(charge_description) LIKE '%courtesy%' OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%' OR LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%' OR LOWER(charge_description) LIKE '%doc%')::numeric,2) officer_base_est,
      ROUND(SUM(sum_amount)::numeric,2) full_esc
    FROM revenue_line_items WHERE bill_code='ESC' AND fetch_month >= '2026-01'
    GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
