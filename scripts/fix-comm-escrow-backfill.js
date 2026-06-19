require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  console.log('=== PRE-FIX June 2026 commissionable per rep (baseline) ===');
  const pre = await pool.query(`
    SELECT sales_rep, ROUND(SUM(commissionable_escrow)::numeric,2) comm
    FROM order_summary WHERE fetch_month='2026-06' AND commissionable_escrow>0
    GROUP BY sales_rep ORDER BY sales_rep
  `);
  const preMap = Object.fromEntries(pre.rows.map(r => [r.sales_rep, r.comm]));
  console.table(pre.rows);

  console.log('\n=== Step 2: Re-backfill (net negatives + cap), only changed rows written ===');
  const up = await pool.query(`
    UPDATE order_summary os
    SET commissionable_escrow = sub.corrected
    FROM (
      SELECT file_number, fetch_month,
        LEAST(
          GREATEST(
            COALESCE(SUM(sum_amount) FILTER (WHERE sum_amount > 0 AND (
              LOWER(charge_description) LIKE '%settlement%'
              OR LOWER(charge_description) LIKE '%courtesy%'
              OR LOWER(charge_description) LIKE '%credit%'
              OR LOWER(charge_description) LIKE '%discount%')), 0)
            + COALESCE(SUM(sum_amount) FILTER (WHERE sum_amount < 0), 0),
            0
          ),
          COALESCE(SUM(sum_amount), 0)
        ) as corrected
      FROM revenue_line_items
      WHERE bill_code='ESC'
      GROUP BY file_number, fetch_month
    ) sub
    WHERE os.file_number=sub.file_number AND os.fetch_month=sub.fetch_month
      AND os.commissionable_escrow IS DISTINCT FROM sub.corrected
  `);
  console.log(`rows changed: ${up.rowCount}`);

  console.log('\n=== Step 3: 4 known orders after fix ===');
  const q3 = await pool.query(`
    SELECT file_number, fetch_month,
      ROUND(commissionable_escrow::numeric,2) commissionable,
      ROUND(escrow_revenue::numeric,2) full_escrow
    FROM order_summary
    WHERE file_number IN ('20014431-OCT','20002643-PRV','20009016-OCT','20015515-OCT')
    ORDER BY fetch_month
  `);
  console.table(q3.rows);

  console.log('\n=== Step 4: invariant violations (must be 0) ===');
  const q4 = await pool.query(`SELECT COUNT(*)::int invariant_violations FROM order_summary WHERE commissionable_escrow > escrow_revenue + 0.01`);
  console.table(q4.rows);

  console.log('\n=== Step 4b: POST-FIX June 2026 vs baseline ===');
  const post = await pool.query(`
    SELECT sales_rep, ROUND(SUM(commissionable_escrow)::numeric,2) comm
    FROM order_summary WHERE fetch_month='2026-06' AND commissionable_escrow>0
    GROUP BY sales_rep ORDER BY sales_rep
  `);
  let allSame = true;
  post.rows.forEach(r => {
    const before = preMap[r.sales_rep];
    const same = String(before) === String(r.comm);
    if (!same) allSame = false;
    console.log(`  ${r.sales_rep}: pre=${before} post=${r.comm} ${same ? 'OK' : 'CHANGED!'}`);
  });
  console.log(`June identical to pre-fix: ${allSame && post.rows.length === pre.rows.length ? 'YES' : 'NO'}`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
