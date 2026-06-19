require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  for (const rep of ['Michael Nouri', 'Sandra Millar']) {
    const month = '2026-06';
    const m = (await pool.query(`
      SELECT ROUND(COALESCE(SUM(title_revenue+underwriter_revenue),0)::numeric,2) title_stream,
             ROUND(COALESCE(SUM(tsg_revenue),0)::numeric,2) tsg_stream,
             ROUND(COALESCE(SUM(CASE WHEN order_type IN ('Title & Escrow','Escrow Only') THEN commissionable_escrow ELSE 0 END),0)::numeric,2) comm_escrow,
             ROUND(SUM(total_revenue)::numeric,2) total_rev
      FROM order_summary WHERE sales_rep=$1 AND fetch_month=$2
    `, [rep, month])).rows[0];

    const titleList = (await pool.query(`
      SELECT ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) s, COUNT(*)::int n
      FROM order_summary WHERE sales_rep=$1 AND fetch_month=$2 AND (title_revenue+underwriter_revenue)>0
    `, [rep, month])).rows[0];

    const escList = (await pool.query(`
      SELECT ROUND(SUM(commissionable_escrow)::numeric,2) s, COUNT(*)::int n
      FROM order_summary WHERE sales_rep=$1 AND fetch_month=$2
        AND order_type IN ('Title & Escrow','Escrow Only') AND commissionable_escrow>0
    `, [rep, month])).rows[0];

    const t = parseFloat(m.title_stream), e = parseFloat(m.comm_escrow), g = parseFloat(m.tsg_stream);
    const repTotal = Math.round((t + e + g) * 100) / 100;
    console.log(`\n=== ${rep} (June 2026) ===`);
    console.log(`  Title stream:   $${t}   | title list: $${titleList.s} (${titleList.n} files) | match: ${Math.abs(parseFloat(titleList.s||0)-t)<0.01}`);
    console.log(`  Escrow stream:  $${e}   | escrow list: $${escList.s||0} (${escList.n} files) | match: ${Math.abs(parseFloat(escList.s||0)-e)<0.01}`);
    console.log(`  TSG stream:     $${g}`);
    console.log(`  repTotalProduction: $${repTotal}`);
    console.log(`  company total_revenue: $${m.total_rev} (diff = tie-in excluded: $${(parseFloat(m.total_rev)-repTotal).toFixed(2)})`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
