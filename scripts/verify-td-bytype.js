require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  const rep = 'Sandra Millar';
  const month = '2026-06';

  const [{ rows: opens }, { rows: types }, { rows: mtd }] = await Promise.all([
    pool.query('SELECT COUNT(*)::int c FROM open_orders WHERE sales_rep=$1 AND open_month=$2', [rep, month]),
    pool.query(`
      SELECT CASE WHEN LOWER(trans_type)='purchase' THEN 'purchase' WHEN LOWER(trans_type)='refinance' THEN 'refinance' ELSE 'other' END t, COUNT(*)::int c
      FROM open_orders WHERE sales_rep=$1 AND open_month=$2 GROUP BY t`, [rep, month]),
    pool.query(`
      SELECT COUNT(*)::int closed,
        COUNT(*) FILTER (WHERE category='Purchase')::int purchase,
        COUNT(*) FILTER (WHERE category='Refinance')::int refi,
        COUNT(*) FILTER (WHERE category='Escrow')::int escrow,
        COUNT(*) FILTER (WHERE category='TSG')::int tsg
      FROM order_summary WHERE sales_rep=$1 AND fetch_month=$2`, [rep, month]),
  ]);

  const byType = Object.fromEntries(types.map(r => [r.t, r.c]));
  const p = byType.purchase || 0;
  const r = byType.refinance || 0;
  const o = byType.other || 0;
  const totalOpens = opens[0].c;

  console.log('Sandra Millar June 2026 reconciliation:');
  console.log(`  mtd.opens = ${totalOpens}`);
  console.log(`  openingsByType purchase=${p} refinance=${r} other(omitted)=${o} sum=${p+r+o}`);
  console.log(`  purchase+refi == opens? ${p + r <= totalOpens} (equal if no other: ${p + r === totalOpens})`);
  console.log(`  mtd.closed = ${mtd[0].closed}`);
  console.log(`  closings purchase=${mtd[0].purchase} refi=${mtd[0].refi} escrow=${mtd[0].escrow} tsg=${mtd[0].tsg}`);
  console.log(`  purchase+refi == closed? ${mtd[0].purchase + mtd[0].refi === mtd[0].closed} (only if no escrow/tsg)`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
