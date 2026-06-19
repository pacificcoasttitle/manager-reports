require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== 1. COMPLETE ESC VOCABULARY (every description + proposed treatment) ===');
  console.table((await pool.query(`
    SELECT charge_description,
      COUNT(*) as lines,
      ROUND(SUM(sum_amount)::numeric,2) as total,
      ROUND(MIN(sum_amount)::numeric,2) as min_amt,
      ROUND(MAX(sum_amount)::numeric,2) as max_amt,
      CASE
        WHEN LOWER(charge_description) LIKE '%settlement%' THEN '1-SETTLEMENT (in)'
        WHEN LOWER(charge_description) LIKE '%courtesy%' OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%' THEN '2-CREDIT (in)'
        WHEN LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%' THEN '3-LOAN TIE-IN (in)'
        WHEN LOWER(charge_description) LIKE '%doc%' THEN '4-DOCS (in)'
        WHEN charge_description IS NULL THEN '5-NULL (reversal?)'
        ELSE '6-EXCLUDED (other)'
      END as officer_treatment
    FROM revenue_line_items WHERE bill_code='ESC'
    GROUP BY charge_description ORDER BY officer_treatment, total DESC`)).rows);

  console.log('\n=== 2. KEYWORD EDGE CASES (%doc% / %credit% potential false positives) ===');
  console.table((await pool.query(`
    SELECT charge_description, COUNT(*) as lines, ROUND(SUM(sum_amount)::numeric,2) as total,
      CASE WHEN LOWER(charge_description) LIKE '%doc%' AND LOWER(charge_description) NOT LIKE '%document%' AND LOWER(charge_description) NOT LIKE '%doc prep%' AND LOWER(charge_description) NOT LIKE '%doc fee%' THEN 'CHECK: %doc% match'
           WHEN LOWER(charge_description) LIKE '%credit%' AND LOWER(charge_description) LIKE '%notary%' THEN 'CHECK: credit+notary'
           ELSE 'ok' END as flag
    FROM revenue_line_items WHERE bill_code='ESC'
      AND (LOWER(charge_description) LIKE '%doc%' OR LOWER(charge_description) LIKE '%credit%')
    GROUP BY charge_description ORDER BY total DESC`)).rows);

  console.log('\n=== 3. NULL-description ESC lines + sibling context ===');
  console.table((await pool.query(`
    SELECT file_number, fetch_month, ROUND(sum_amount::numeric,2) as amount,
      (SELECT STRING_AGG(r2.charge_description || ': ' || r2.sum_amount, ' | ')
       FROM revenue_line_items r2
       WHERE r2.file_number=r1.file_number AND r2.fetch_month=r1.fetch_month
         AND r2.bill_code='ESC' AND r2.charge_description IS NOT NULL) as sibling_lines
    FROM revenue_line_items r1
    WHERE bill_code='ESC' AND charge_description IS NULL
    ORDER BY fetch_month`)).rows);

  console.log('\n=== 4. EXCLUDED bucket (everything left out of officer base) ===');
  console.table((await pool.query(`
    SELECT charge_description, COUNT(*) as lines, ROUND(SUM(sum_amount)::numeric,2) as total
    FROM revenue_line_items WHERE bill_code='ESC' AND charge_description IS NOT NULL
      AND NOT (LOWER(charge_description) LIKE '%settlement%'
        OR LOWER(charge_description) LIKE '%courtesy%' OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%'
        OR LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%'
        OR LOWER(charge_description) LIKE '%doc%')
    GROUP BY charge_description ORDER BY total DESC`)).rows);

  console.log('\n=== 5. NOTARY-CREDIT TRAP (any %notary% line + which keywords it matches) ===');
  console.table((await pool.query(`
    SELECT charge_description, ROUND(SUM(sum_amount)::numeric,2) as total,
      LOWER(charge_description) LIKE '%settlement%' as m_settlement,
      (LOWER(charge_description) LIKE '%courtesy%' OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%') as m_credit,
      (LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%') as m_tiein,
      LOWER(charge_description) LIKE '%doc%' as m_docs,
      LOWER(charge_description) LIKE '%notary%' as has_notary
    FROM revenue_line_items WHERE bill_code='ESC' AND LOWER(charge_description) LIKE '%notary%'
    GROUP BY charge_description`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
