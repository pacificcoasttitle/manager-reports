require('dotenv').config();
const pool = require('../database/pool');
const ALLOW = `(LOWER(charge_description) LIKE '%settlement%' OR LOWER(charge_description) LIKE '%courtesy%' OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%')`;
const BREAKDOWN = `
  WITH esc_breakdown AS (
    SELECT file_number, fetch_month,
      SUM(sum_amount) FILTER (WHERE ${ALLOW}) as current_commissionable,
      SUM(sum_amount) FILTER (WHERE ${ALLOW} AND sum_amount > 0) as positive_settlements,
      SUM(sum_amount) FILTER (WHERE sum_amount < 0) as all_negatives,
      SUM(sum_amount) as full_escrow
    FROM revenue_line_items WHERE bill_code='ESC'
    GROUP BY file_number, fetch_month
  )`;

(async () => {
  console.log('=== 1. All affected orders (top 30 by overstatement) ===');
  const q1 = await pool.query(`${BREAKDOWN}
    SELECT file_number, fetch_month,
      ROUND(current_commissionable::numeric,2) current_comm,
      ROUND((positive_settlements + COALESCE(all_negatives,0))::numeric,2) corrected_comm,
      ROUND((current_commissionable - (positive_settlements + COALESCE(all_negatives,0)))::numeric,2) overstatement,
      ROUND(full_escrow::numeric,2) full_escrow
    FROM esc_breakdown
    WHERE ABS(current_commissionable - (positive_settlements + COALESCE(all_negatives,0))) > 0.01
    ORDER BY overstatement DESC LIMIT 30`);
  console.table(q1.rows);

  const tot = await pool.query(`${BREAKDOWN}
    SELECT COUNT(*) FILTER (WHERE ABS(current_commissionable - (positive_settlements + COALESCE(all_negatives,0))) > 0.01)::int affected_orders,
      ROUND(SUM(current_commissionable - (positive_settlements + COALESCE(all_negatives,0)))::numeric,2) total_overstatement
    FROM esc_breakdown`);
  console.log('TOTALS:'); console.table(tot.rows);

  console.log('\n=== 2. By month ===');
  const q2 = await pool.query(`${BREAKDOWN}
    SELECT fetch_month,
      COUNT(*) FILTER (WHERE ABS(current_commissionable - (positive_settlements + COALESCE(all_negatives,0))) > 0.01)::int affected_orders,
      ROUND(SUM(current_commissionable - (positive_settlements + COALESCE(all_negatives,0)))::numeric,2) month_overstatement
    FROM esc_breakdown
    GROUP BY fetch_month
    HAVING SUM(current_commissionable - (positive_settlements + COALESCE(all_negatives,0))) <> 0
    ORDER BY fetch_month`);
  console.table(q2.rows);

  console.log('\n=== 3. Duplicate-settlement + null-reversal shape ===');
  const q3 = await pool.query(`
    SELECT file_number, fetch_month,
      COUNT(*) FILTER (WHERE LOWER(charge_description) LIKE '%settlement%' AND sum_amount > 0)::int pos_settle_lines,
      COUNT(*) FILTER (WHERE charge_description IS NULL AND sum_amount < 0)::int null_neg_lines
    FROM revenue_line_items WHERE bill_code='ESC'
    GROUP BY file_number, fetch_month
    HAVING COUNT(*) FILTER (WHERE LOWER(charge_description) LIKE '%settlement%' AND sum_amount > 0) > 1
       AND COUNT(*) FILTER (WHERE charge_description IS NULL AND sum_amount < 0) >= 1
    ORDER BY fetch_month`);
  console.log(`null-reversal-shape orders: ${q3.rows.length}`);
  console.table(q3.rows);

  console.log('\n=== 4. June 2026 live rep exposure ===');
  const q4 = await pool.query(`
    WITH esc_breakdown AS (
      SELECT rli.file_number, os.sales_rep,
        SUM(rli.sum_amount) FILTER (WHERE (LOWER(rli.charge_description) LIKE '%settlement%' OR LOWER(rli.charge_description) LIKE '%courtesy%' OR LOWER(rli.charge_description) LIKE '%credit%' OR LOWER(rli.charge_description) LIKE '%discount%')) current_comm,
        SUM(rli.sum_amount) FILTER (WHERE (LOWER(rli.charge_description) LIKE '%settlement%' OR LOWER(rli.charge_description) LIKE '%courtesy%' OR LOWER(rli.charge_description) LIKE '%credit%' OR LOWER(rli.charge_description) LIKE '%discount%') AND rli.sum_amount > 0) pos,
        SUM(rli.sum_amount) FILTER (WHERE rli.sum_amount < 0) negs
      FROM revenue_line_items rli
      JOIN order_summary os ON rli.file_number=os.file_number AND rli.fetch_month=os.fetch_month
      WHERE rli.bill_code='ESC' AND rli.fetch_month='2026-06'
      GROUP BY rli.file_number, os.sales_rep
    )
    SELECT sales_rep, ROUND(SUM(current_comm - (pos + COALESCE(negs,0)))::numeric,2) overstatement
    FROM esc_breakdown
    WHERE ABS(current_comm - (pos + COALESCE(negs,0))) > 0.01
    GROUP BY sales_rep`);
  console.log(q4.rows.length ? '' : '(none — no June 2026 live exposure)');
  console.table(q4.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
