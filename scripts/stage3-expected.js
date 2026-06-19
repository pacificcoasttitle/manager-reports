require('dotenv').config();
const pool = require('../database/pool');
const comm = `SUM(CASE WHEN escrow_revenue > 0 THEN commissionable_escrow ELSE 0 END)`;
(async () => {
  for (const [rep, month] of [['Team Meza','2026-03'], ['Sandra Millar','2026-06']]) {
    const r = (await pool.query(`
      SELECT ROUND(COALESCE(SUM(title_revenue+underwriter_revenue),0)::numeric,2) title,
        ROUND(COALESCE(${comm},0)::numeric,2) comm_escrow,
        ROUND(COALESCE(SUM(tsg_revenue),0)::numeric,2) tsg
      FROM order_summary WHERE sales_rep=$1 AND fetch_month=$2`, [rep, month])).rows[0];
    const total = Math.round((parseFloat(r.title)+parseFloat(r.comm_escrow)+parseFloat(r.tsg))*100)/100;
    console.log(`${rep} ${month}: title=${r.title} commEscrow=${r.comm_escrow} tsg=${r.tsg} repTotal=${total}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
