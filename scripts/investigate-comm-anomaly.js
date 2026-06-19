require('dotenv').config();
const pool = require('../database/pool');
const ALLOW = `(LOWER(rli.charge_description) LIKE '%settlement%' OR LOWER(rli.charge_description) LIKE '%courtesy%' OR LOWER(rli.charge_description) LIKE '%credit%' OR LOWER(rli.charge_description) LIKE '%discount%')`;

(async () => {
  console.log('=== 1. Every ESC line on the 4 anomaly orders ===');
  const q1 = await pool.query(`
    WITH anomalies AS (
      SELECT file_number, fetch_month, escrow_revenue, commissionable_escrow
      FROM order_summary WHERE commissionable_escrow > escrow_revenue + 0.01
    )
    SELECT a.file_number, a.fetch_month,
      ROUND(a.escrow_revenue::numeric,2) full_escrow,
      ROUND(a.commissionable_escrow::numeric,2) commissionable,
      rli.charge_description,
      ROUND(rli.sum_amount::numeric,2) line_amount,
      CASE WHEN ${ALLOW} THEN 'COUNTED' ELSE 'not counted' END treatment,
      rli.bill_code
    FROM anomalies a
    JOIN revenue_line_items rli ON rli.file_number=a.file_number AND rli.fetch_month=a.fetch_month
    WHERE rli.bill_code='ESC'
    ORDER BY a.file_number, rli.sum_amount DESC
  `);
  console.table(q1.rows);

  console.log('\n=== 1b. ALL bill codes on the anomaly orders (in case ESC filter hides lines) ===');
  const q1b = await pool.query(`
    WITH anomalies AS (
      SELECT file_number, fetch_month FROM order_summary WHERE commissionable_escrow > escrow_revenue + 0.01
    )
    SELECT a.file_number, rli.bill_code, rli.charge_description, ROUND(rli.sum_amount::numeric,2) line_amount
    FROM anomalies a
    JOIN revenue_line_items rli ON rli.file_number=a.file_number AND rli.fetch_month=a.fetch_month
    ORDER BY a.file_number, rli.bill_code, rli.sum_amount DESC
  `);
  console.table(q1b.rows);

  console.log('\n=== 2. full vs commissionable vs non-counted sum per anomaly ===');
  const q2 = await pool.query(`
    WITH anomalies AS (
      SELECT file_number, fetch_month FROM order_summary WHERE commissionable_escrow > escrow_revenue + 0.01
    )
    SELECT a.file_number,
      ROUND(SUM(rli.sum_amount)::numeric,2) all_esc_sum,
      ROUND(SUM(rli.sum_amount) FILTER (WHERE ${ALLOW})::numeric,2) commissionable_sum,
      ROUND(SUM(rli.sum_amount) FILTER (WHERE NOT ${ALLOW})::numeric,2) non_counted_sum,
      COUNT(*) FILTER (WHERE ${ALLOW})::int counted_lines,
      COUNT(*) FILTER (WHERE NOT ${ALLOW})::int noncounted_lines
    FROM anomalies a
    JOIN revenue_line_items rli ON rli.file_number=a.file_number AND rli.fetch_month=a.fetch_month
    WHERE rli.bill_code='ESC'
    GROUP BY a.file_number ORDER BY a.file_number
  `);
  console.table(q2.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
