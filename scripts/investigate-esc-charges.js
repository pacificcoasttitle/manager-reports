require('dotenv').config();
const pool = require('../database/pool');

// revenue_line_items uses sum_amount (not amount)
const AMT = 'sum_amount';

async function q(label, sql, params = []) {
  console.log('\n' + '='.repeat(72));
  console.log(label);
  console.log('='.repeat(72));
  const { rows } = await pool.query(sql, params);
  if (!rows.length) console.log('  (no rows)');
  else console.table(rows);
  return rows;
}

(async () => {
  const { rows: mx } = await pool.query('SELECT MAX(fetch_month) m FROM revenue_line_items');
  const ym = mx[0].m;
  console.log('MAX fetch_month:', ym);

  // 1. Full vocabulary
  await q('1. FULL ESC CHARGE DESCRIPTION VOCABULARY (all time)', `
    SELECT charge_description,
      COUNT(*)::int as line_count,
      ROUND(SUM(${AMT})::numeric, 2) as total_amount,
      ROUND(AVG(${AMT})::numeric, 2) as avg_amount,
      ROUND(MIN(${AMT})::numeric, 2) as min_amount,
      ROUND(MAX(${AMT})::numeric, 2) as max_amount
    FROM revenue_line_items
    WHERE bill_code = 'ESC'
    GROUP BY charge_description
    ORDER BY total_amount DESC NULLS LAST`);

  // 2. Current month
  await q(`2. CURRENT MONTH VOCABULARY (${ym})`, `
    SELECT charge_description,
      COUNT(*)::int as line_count,
      ROUND(SUM(${AMT})::numeric, 2) as total_amount
    FROM revenue_line_items
    WHERE bill_code = 'ESC' AND fetch_month = $1
    GROUP BY charge_description
    ORDER BY total_amount DESC NULLS LAST`, [ym]);

  // 3. Three buckets
  await q('3. THREE-BUCKET CATEGORIZATION (all time)', `
    SELECT
      CASE
        WHEN charge_description ILIKE '%settlement%' THEN 'SETTLEMENT FEE (rep credit)'
        WHEN charge_description ILIKE '%loan tie%' OR charge_description ILIKE '%tie-in%' OR charge_description ILIKE '%tie in%' THEN 'LOAN TIE-IN (NO credit)'
        WHEN charge_description ILIKE '%courtesy%' OR charge_description ILIKE '%credit%' OR charge_description ILIKE '%discount%' THEN 'DISCOUNT/CREDIT (rep credit)'
        ELSE 'OTHER — NEEDS REVIEW'
      END as bucket,
      COUNT(*)::int as line_count,
      ROUND(SUM(${AMT})::numeric, 2) as total_amount
    FROM revenue_line_items
    WHERE bill_code = 'ESC'
    GROUP BY bucket
    ORDER BY total_amount DESC`);

  // 4. OTHER detail
  await q('4. OTHER / UNCLEAR DESCRIPTIONS (all time)', `
    SELECT charge_description,
      COUNT(*)::int as line_count,
      ROUND(SUM(${AMT})::numeric, 2) as total_amount
    FROM revenue_line_items
    WHERE bill_code = 'ESC'
      AND charge_description NOT ILIKE '%settlement%'
      AND charge_description NOT ILIKE '%loan tie%'
      AND charge_description NOT ILIKE '%tie-in%'
      AND charge_description NOT ILIKE '%tie in%'
      AND charge_description NOT ILIKE '%courtesy%'
      AND charge_description NOT ILIKE '%credit%'
      AND charge_description NOT ILIKE '%discount%'
    GROUP BY charge_description
    ORDER BY total_amount DESC NULLS LAST`);

  // 5. Loan tie-in over time
  await q('5. LOAN TIE-IN vs SETTLEMENT OVER TIME', `
    SELECT fetch_month,
      COUNT(*) FILTER (WHERE charge_description ILIKE '%loan tie%' OR charge_description ILIKE '%tie-in%' OR charge_description ILIKE '%tie in%')::int as tie_in_lines,
      ROUND(SUM(${AMT}) FILTER (WHERE charge_description ILIKE '%loan tie%' OR charge_description ILIKE '%tie-in%' OR charge_description ILIKE '%tie in%')::numeric, 2) as tie_in_amount,
      COUNT(*) FILTER (WHERE charge_description ILIKE '%settlement%')::int as settlement_lines,
      ROUND(SUM(${AMT}) FILTER (WHERE charge_description ILIKE '%settlement%')::numeric, 2) as settlement_amount
    FROM revenue_line_items
    WHERE bill_code = 'ESC'
    GROUP BY fetch_month
    ORDER BY fetch_month`);

  // 6. Impact by rep (current month)
  await q(`6. IMPACT BY REP (${ym})`, `
    SELECT os.sales_rep,
      ROUND(SUM(rli.${AMT})::numeric, 2) as total_esc,
      ROUND(SUM(rli.${AMT}) FILTER (
        WHERE rli.charge_description ILIKE '%settlement%'
           OR rli.charge_description ILIKE '%courtesy%'
           OR rli.charge_description ILIKE '%credit%'
           OR rli.charge_description ILIKE '%discount%'
      )::numeric, 2) as commissionable_esc,
      ROUND(SUM(rli.${AMT}) FILTER (
        WHERE rli.charge_description ILIKE '%loan tie%'
           OR rli.charge_description ILIKE '%tie-in%'
           OR rli.charge_description ILIKE '%tie in%'
      )::numeric, 2) as loan_tie_in_excluded
    FROM revenue_line_items rli
    JOIN order_summary os ON rli.file_number = os.file_number AND rli.fetch_month = os.fetch_month
    WHERE rli.bill_code = 'ESC'
      AND rli.fetch_month = $1
      AND os.sales_rep IS NOT NULL AND os.sales_rep != ''
    GROUP BY os.sales_rep
    HAVING SUM(rli.${AMT}) > 0
    ORDER BY commissionable_esc DESC NULLS LAST`, [ym]);

  // 7. Reconciliation
  await q(`7. RECONCILIATION (${ym})`, `
    SELECT
      ROUND(SUM(${AMT})::numeric, 2) as all_esc_line_items,
      (SELECT ROUND(SUM(escrow_revenue)::numeric, 2) FROM order_summary WHERE fetch_month = $1) as order_summary_escrow
    FROM revenue_line_items
    WHERE bill_code = 'ESC' AND fetch_month = $1`, [ym]);

  // Bonus: null/blank descriptions
  await q('BONUS: NULL/blank charge_description on ESC lines', `
    SELECT
      COUNT(*) FILTER (WHERE charge_description IS NULL OR TRIM(charge_description) = '')::int as blank_desc,
      COUNT(*)::int as total_esc_lines,
      ROUND(SUM(${AMT}) FILTER (WHERE charge_description IS NULL OR TRIM(charge_description) = '')::numeric, 2) as blank_amount
    FROM revenue_line_items WHERE bill_code = 'ESC'`);

  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
