require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  const { buildEscrowOfficerEmailHtml, getActiveEscrowOfficers } = require('../lib/escrow-officer-email');
  const { buildEscrowManagerEmailHtml } = require('../lib/escrow-manager-email');

  console.log('=== Officer emails build (officer base) + recon guard ===');
  for (const o of await getActiveEscrowOfficers()) {
    const { html, hasData } = await buildEscrowOfficerEmailHtml(o.officer_name);
    console.log(`${o.officer_name.padEnd(22)} html=${html.length}b hasData=${hasData}`);
  }

  console.log('\n=== Manager rollup build + recon guard ===');
  const { html, hasData } = await buildEscrowManagerEmailHtml('Analleli Ayala');
  console.log(`Analleli Ayala         html=${html.length}b hasData=${hasData}`);

  console.log('\n=== Part 7: per-officer officer-base (June) ===');
  console.table((await pool.query(`
    SELECT escrow_officer, ROUND(SUM(officer_commissionable_escrow)::numeric,2) as officer_mtd
    FROM order_summary WHERE fetch_month='2026-06' AND escrow_revenue > 0
      AND escrow_officer IN ('Christine Quintanar','Karla Casco','Joseph Gomez','Lupe Vidaca','Anna Ballesteros')
    GROUP BY escrow_officer ORDER BY officer_mtd DESC`)).rows);

  console.log('\n=== Part 7: team total (should = sum of 5) ===');
  console.table((await pool.query(`
    SELECT ROUND(SUM(officer_commissionable_escrow)::numeric,2) as team_total
    FROM order_summary WHERE fetch_month='2026-06' AND escrow_revenue > 0
      AND escrow_officer IN ('Christine Quintanar','Karla Casco','Joseph Gomez','Lupe Vidaca','Anna Ballesteros')`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
