require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== Step 1: Add column ===');
  await pool.query(`ALTER TABLE order_summary ADD COLUMN IF NOT EXISTS officer_commissionable_escrow NUMERIC(12,2) DEFAULT 0`);
  console.log('column ready');

  console.log('\n=== Step 3: Backfill ===');
  const u = await pool.query(`
    UPDATE order_summary os
    SET officer_commissionable_escrow = sub.val
    FROM (
      SELECT file_number, fetch_month,
        LEAST(
          GREATEST(
            COALESCE(SUM(sum_amount) FILTER (WHERE sum_amount > 0 AND (
              LOWER(charge_description) LIKE '%settlement%' OR LOWER(charge_description) LIKE '%courtesy%'
              OR LOWER(charge_description) LIKE '%credit%' OR LOWER(charge_description) LIKE '%discount%'
              OR LOWER(charge_description) LIKE '%loan tie%' OR LOWER(charge_description) LIKE '%tie in%'
              OR LOWER(charge_description) LIKE '%doc%')), 0)
            + COALESCE(SUM(sum_amount) FILTER (WHERE sum_amount < 0), 0),
            0
          ),
          COALESCE(SUM(sum_amount), 0)
        ) as val
      FROM revenue_line_items WHERE bill_code = 'ESC'
      GROUP BY file_number, fetch_month
    ) sub
    WHERE os.file_number = sub.file_number AND os.fetch_month = sub.fetch_month
      AND os.officer_commissionable_escrow IS DISTINCT FROM sub.val`);
  console.log('rows updated:', u.rowCount);
  const n = await pool.query(`UPDATE order_summary SET officer_commissionable_escrow = 0 WHERE officer_commissionable_escrow IS NULL`);
  console.log('null->0:', n.rowCount);

  console.log('\n=== Step 4A: Invariant officer <= full (must be 0) ===');
  console.table((await pool.query(`SELECT COUNT(*) as violations FROM order_summary WHERE officer_commissionable_escrow > escrow_revenue + 0.01`)).rows);

  console.log('\n=== Step 4B: Ordering rep <= officer <= full (must be 0) ===');
  console.table((await pool.query(`
    SELECT COUNT(*) as ordering_violations FROM order_summary
    WHERE escrow_revenue > 0
      AND (commissionable_escrow > officer_commissionable_escrow + 0.01
           OR officer_commissionable_escrow > escrow_revenue + 0.01)`)).rows);

  console.log('\n=== Step 4C: Per-month rep/officer/full ===');
  console.table((await pool.query(`
    SELECT fetch_month,
      ROUND(SUM(commissionable_escrow)::numeric,2) as rep_base,
      ROUND(SUM(officer_commissionable_escrow)::numeric,2) as officer_base,
      ROUND(SUM(escrow_revenue)::numeric,2) as full_escrow
    FROM order_summary WHERE escrow_revenue > 0 AND fetch_month >= '2025-08'
    GROUP BY fetch_month ORDER BY fetch_month`)).rows);

  console.log('\n=== Step 4D: 4 known double-count orders capped ===');
  console.table((await pool.query(`
    SELECT file_number, fetch_month,
      ROUND(commissionable_escrow::numeric,2) as rep,
      ROUND(officer_commissionable_escrow::numeric,2) as officer,
      ROUND(escrow_revenue::numeric,2) as full
    FROM order_summary
    WHERE file_number IN ('20014431-OCT','20002643-PRV','20009016-OCT','20015515-OCT')
    ORDER BY fetch_month`)).rows);

  console.log('\n=== Step 4E: Per-officer June rep vs officer base ===');
  console.table((await pool.query(`
    SELECT escrow_officer,
      ROUND(SUM(commissionable_escrow)::numeric,2) as rep_base_shown_now,
      ROUND(SUM(officer_commissionable_escrow)::numeric,2) as officer_base_after_swap
    FROM order_summary WHERE fetch_month = '2026-06' AND escrow_revenue > 0
      AND escrow_officer IN ('Christine Quintanar','Karla Casco','Joseph Gomez','Lupe Vidaca','Anna Ballesteros')
    GROUP BY escrow_officer ORDER BY officer_base_after_swap DESC`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
