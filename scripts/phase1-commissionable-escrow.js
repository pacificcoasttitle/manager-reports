require('dotenv').config();
const pool = require('../database/pool');

const r = (v) => (v == null ? '0.00' : Number(v).toFixed(2));

(async () => {
  console.log('=== Step 1: Add column ===');
  await pool.query(`ALTER TABLE order_summary ADD COLUMN IF NOT EXISTS commissionable_escrow NUMERIC(12,2) DEFAULT 0`);
  console.log('column ensured.');

  console.log('\n=== Step 3: Backfill (April 2025 forward) ===');
  const up = await pool.query(`
    UPDATE order_summary os
    SET commissionable_escrow = COALESCE(sub.total, 0)
    FROM (
      SELECT file_number, fetch_month, SUM(sum_amount) AS total
      FROM revenue_line_items
      WHERE bill_code = 'ESC'
        AND (
          LOWER(charge_description) LIKE '%settlement%'
          OR LOWER(charge_description) LIKE '%courtesy%'
          OR LOWER(charge_description) LIKE '%credit%'
          OR LOWER(charge_description) LIKE '%discount%'
        )
      GROUP BY file_number, fetch_month
    ) sub
    WHERE os.file_number = sub.file_number AND os.fetch_month = sub.fetch_month
  `);
  console.log(`rows updated with a match: ${up.rowCount}`);
  const nul = await pool.query(`UPDATE order_summary SET commissionable_escrow = 0 WHERE commissionable_escrow IS NULL`);
  console.log(`null -> 0 rows: ${nul.rowCount}`);

  console.log('\n=== Step 4A: June commissionable vs total escrow ===');
  const a = (await pool.query(`
    SELECT ROUND(SUM(commissionable_escrow)::numeric,2) commissionable,
           ROUND(SUM(escrow_revenue)::numeric,2) total_escrow,
           ROUND(SUM(escrow_revenue - commissionable_escrow)::numeric,2) excluded
    FROM order_summary WHERE fetch_month='2026-06'
  `)).rows[0];
  console.log(`commissionable=$${r(a.commissionable)} | total_escrow=$${r(a.total_escrow)} | excluded=$${r(a.excluded)}`);

  console.log('\n=== Step 4B: Loan tie-in total (June) ===');
  const b = (await pool.query(`
    SELECT ROUND(SUM(sum_amount)::numeric,2) tie_in_total
    FROM revenue_line_items
    WHERE bill_code='ESC' AND fetch_month='2026-06'
      AND (LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%')
  `)).rows[0];
  console.log(`tie_in_total=$${r(b.tie_in_total)}`);

  console.log('\n=== Step 4B2: Full breakdown of excluded ESC lines (June) ===');
  const b2 = await pool.query(`
    SELECT charge_description, ROUND(SUM(sum_amount)::numeric,2) amt, COUNT(*)::int n
    FROM revenue_line_items
    WHERE bill_code='ESC' AND fetch_month='2026-06'
      AND NOT (
        LOWER(charge_description) LIKE '%settlement%'
        OR LOWER(charge_description) LIKE '%courtesy%'
        OR LOWER(charge_description) LIKE '%credit%'
        OR LOWER(charge_description) LIKE '%discount%'
      )
    GROUP BY charge_description ORDER BY amt DESC
  `);
  console.table(b2.rows);

  console.log('\n=== Step 4C: Per-rep June commissionable escrow ===');
  const c = await pool.query(`
    SELECT sales_rep,
      ROUND(SUM(commissionable_escrow)::numeric,2) commissionable_escrow,
      ROUND(SUM(escrow_revenue)::numeric,2) full_escrow,
      ROUND(SUM(total_revenue)::numeric,2) total_revenue
    FROM order_summary
    WHERE fetch_month='2026-06'
      AND order_type IN ('Title & Escrow','Escrow Only')
      AND commissionable_escrow > 0
    GROUP BY sales_rep ORDER BY commissionable_escrow DESC
  `);
  console.table(c.rows);

  console.log('\n=== Step 4D: total_revenue / escrow_revenue untouched, reconciliation ===');
  const d = (await pool.query(`
    SELECT ROUND(SUM(total_revenue)::numeric,2) total_rev,
           ROUND(SUM(escrow_revenue)::numeric,2) escrow_rev,
           ROUND(SUM(title_revenue+underwriter_revenue+escrow_revenue+tsg_revenue)::numeric,2) parts_sum
    FROM order_summary WHERE fetch_month='2026-06'
  `)).rows[0];
  console.log(`total_rev=$${r(d.total_rev)} | escrow_rev=$${r(d.escrow_rev)} | parts_sum=$${r(d.parts_sum)} | total==parts: ${r(d.total_rev)===r(d.parts_sum)}`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
