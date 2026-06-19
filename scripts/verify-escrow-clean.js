require('dotenv').config();
const pool = require('../database/pool');
const ALLOW = `(LOWER(charge_description) LIKE '%settlement%' OR LOWER(charge_description) LIKE '%courtesy%' OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%')`;

(async () => {
  console.log('=== 1. Michael Nouri ESC line items (counted vs excluded) ===');
  const q1 = await pool.query(`
    SELECT rli.file_number, rli.charge_description,
      ROUND(rli.sum_amount::numeric,2) amount,
      CASE WHEN ${ALLOW.replace(/charge_description/g, 'rli.charge_description')} THEN 'COUNTED' ELSE 'EXCLUDED' END treatment
    FROM revenue_line_items rli
    JOIN order_summary os ON rli.file_number=os.file_number AND rli.fetch_month=os.fetch_month
    WHERE os.sales_rep='Michael Nouri' AND rli.fetch_month='2026-06' AND rli.bill_code='ESC'
    ORDER BY treatment, rli.sum_amount DESC
  `);
  console.table(q1.rows);

  console.log('\n=== 2. Nouri totals ===');
  const q2 = await pool.query(`
    SELECT ROUND(SUM(sum_amount) FILTER (WHERE ${ALLOW})::numeric,2) commissionable,
      ROUND(SUM(sum_amount) FILTER (WHERE LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%')::numeric,2) loan_tie_in_excluded,
      ROUND(SUM(sum_amount)::numeric,2) total_esc
    FROM revenue_line_items rli
    JOIN order_summary os ON rli.file_number=os.file_number AND rli.fetch_month=os.fetch_month
    WHERE os.sales_rep='Michael Nouri' AND rli.fetch_month='2026-06' AND rli.bill_code='ESC'
  `);
  console.table(q2.rows);

  console.log('\n=== 3. Nouri stream reconciliation ===');
  const q3 = await pool.query(`
    SELECT ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) title_stream,
      ROUND(SUM(commissionable_escrow)::numeric,2) escrow_stream,
      ROUND(SUM(tsg_revenue)::numeric,2) tsg_stream,
      ROUND(SUM(title_revenue+underwriter_revenue+commissionable_escrow+tsg_revenue)::numeric,2) rep_total,
      ROUND(SUM(total_revenue)::numeric,2) company_total
    FROM order_summary WHERE sales_rep='Michael Nouri' AND fetch_month='2026-06'
  `);
  console.table(q3.rows);

  console.log('\n=== 4. Other 3 reps ===');
  const q4 = await pool.query(`
    SELECT sales_rep,
      ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) title,
      ROUND(SUM(commissionable_escrow)::numeric,2) escrow,
      ROUND(SUM(tsg_revenue)::numeric,2) tsg,
      ROUND(SUM(title_revenue+underwriter_revenue+commissionable_escrow+tsg_revenue)::numeric,2) rep_total,
      ROUND(SUM(total_revenue)::numeric,2) company_total,
      ROUND(SUM(total_revenue-(title_revenue+underwriter_revenue+commissionable_escrow+tsg_revenue))::numeric,2) tie_in_gap
    FROM order_summary
    WHERE sales_rep IN ('Sandra Millar','Angeline Wu','Sonia Flores') AND fetch_month='2026-06'
    GROUP BY sales_rep ORDER BY sales_rep
  `);
  console.table(q4.rows);

  console.log('\n=== 5. Company-wide: every description flowing into commissionable_escrow (June) ===');
  const q5 = await pool.query(`
    SELECT rli.charge_description, COUNT(*)::int lines, ROUND(SUM(rli.sum_amount)::numeric,2) total
    FROM revenue_line_items rli
    WHERE rli.bill_code='ESC' AND rli.fetch_month='2026-06' AND ${ALLOW.replace(/charge_description/g, 'rli.charge_description')}
    GROUP BY rli.charge_description ORDER BY total DESC
  `);
  console.table(q5.rows);

  console.log('\n=== 5b. ALL-TIME company-wide commissionable descriptions (broader proof) ===');
  const q5b = await pool.query(`
    SELECT rli.charge_description, COUNT(*)::int lines, ROUND(SUM(rli.sum_amount)::numeric,2) total
    FROM revenue_line_items rli
    WHERE rli.bill_code='ESC' AND ${ALLOW.replace(/charge_description/g, 'rli.charge_description')}
    GROUP BY rli.charge_description ORDER BY total DESC
  `);
  console.table(q5b.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
