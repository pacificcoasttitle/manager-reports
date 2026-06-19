require('dotenv').config();
const pool = require('../database/pool');
const F = 'title_revenue + underwriter_revenue + commissionable_escrow + tsg_revenue';

(async () => {
  console.log('=== Step 4: deal-type split per rep (June 2026) ===');
  const q = await pool.query(`
    SELECT sales_rep,
      ROUND(SUM(CASE WHEN LOWER(trans_type)='purchase' THEN ${F} ELSE 0 END)::numeric,2) purchase,
      ROUND(SUM(CASE WHEN LOWER(trans_type)='refinance' THEN ${F} ELSE 0 END)::numeric,2) refinance,
      ROUND(SUM(CASE WHEN LOWER(trans_type) NOT IN ('purchase','refinance') OR trans_type IS NULL THEN ${F} ELSE 0 END)::numeric,2) other,
      ROUND(SUM(${F})::numeric,2) rep_total,
      ROUND(SUM(tsg_revenue)::numeric,2) tsg_check
    FROM order_summary
    WHERE sales_rep IN ('Sandra Millar','Michael Nouri','Angeline Wu','Sonia Flores') AND fetch_month='2026-06'
    GROUP BY sales_rep ORDER BY sales_rep
  `);
  const rows = q.rows.map(r => ({
    sales_rep: r.sales_rep,
    purchase: r.purchase, refinance: r.refinance, other: r.other, rep_total: r.rep_total,
    sum_pro: (parseFloat(r.purchase)+parseFloat(r.refinance)+parseFloat(r.other)).toFixed(2),
    matches: Math.abs((parseFloat(r.purchase)+parseFloat(r.refinance)+parseFloat(r.other))-parseFloat(r.rep_total))<0.01,
    tsg: r.tsg_check,
    other_ge_tsg: parseFloat(r.other) >= parseFloat(r.tsg_check),
  }));
  console.table(rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
