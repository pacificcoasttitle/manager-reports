require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  const month = '2026-06';
  // Replicate the new openTypeResult query for a few reps, confirm sum == opens
  for (const rep of ['Sandra Millar', 'Team Meza']) {
    const { rows } = await pool.query(`
      SELECT CASE
        WHEN category='Purchase' THEN 'purchase'
        WHEN category='Refinance' THEN 'refinance'
        WHEN category='Escrow' THEN 'escrow'
        WHEN category='TSG' THEN 'tsg'
        ELSE 'other' END as type, COUNT(*)::int as count
      FROM open_orders WHERE sales_rep=$1 AND open_month=$2 GROUP BY type`, [rep, month]);
    const { rows: o } = await pool.query(`SELECT COUNT(*)::int as opens FROM open_orders WHERE sales_rep=$1 AND open_month=$2`, [rep, month]);
    const b = { purchase:0, refinance:0, escrow:0, tsg:0, other:0 };
    rows.forEach(r => { if (r.type in b) b[r.type] = r.count; });
    const sum = b.purchase+b.refinance+b.escrow+b.tsg+b.other;
    console.log(`${rep}: ${JSON.stringify(b)} sum=${sum} opens=${o[0].opens} ${sum===o[0].opens?'OK':'MISMATCH'}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
