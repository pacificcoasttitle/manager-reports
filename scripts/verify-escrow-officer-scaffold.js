require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== open_orders has escrow_officer? ===');
  console.table((await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='open_orders' AND column_name IN ('escrow_officer','order_type','received_date','open_month')`)).rows);

  console.log('\n=== Step 5: June commissionable (rep base) per escrow officer ===');
  console.table((await pool.query(`
    SELECT escrow_officer,
      COUNT(*) FILTER (WHERE commissionable_escrow > 0) as files,
      ROUND(SUM(commissionable_escrow)::numeric, 2) as mtd_commissionable
    FROM order_summary
    WHERE fetch_month = '2026-06' AND escrow_revenue > 0
      AND escrow_officer IN ('Christine Quintanar','Karla Casco','Joseph Gomez','Lupe Vidaca','Anna Ballesteros')
    GROUP BY escrow_officer ORDER BY mtd_commissionable DESC`)).rows);

  console.log('\n=== Build + reconciliation guard per active officer ===');
  const { buildEscrowOfficerEmailHtml, getActiveEscrowOfficers } = require('../lib/escrow-officer-email');
  for (const o of await getActiveEscrowOfficers()) {
    const { html, hasData } = await buildEscrowOfficerEmailHtml(o.officer_name);
    console.log(`${o.officer_name.padEnd(22)} html=${html.length}b hasData=${hasData}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
