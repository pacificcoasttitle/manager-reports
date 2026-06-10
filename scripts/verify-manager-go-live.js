require('dotenv').config();
const { buildRepEmailHtml } = require('../lib/rep-email');
const pool = require('../database/pool');

const heroOf = (html) => (html.match(/Month-to-Date Revenue<\/div>\s*<div[^>]*>([^<]+)</) || [])[1] || '?';

(async () => {
  const { rows: flag } = await pool.query("SELECT value FROM app_settings WHERE key = 'manager_emails_enabled'");
  console.log('manager_emails_enabled:', flag[0]?.value ?? '(unset)');

  const { rows } = await pool.query(`
    SELECT os.sales_rep, rma.manager_name, ROUND(SUM(os.total_revenue)::numeric, 2) as mtd_revenue
    FROM order_summary os
    JOIN rep_manager_assignments rma ON os.sales_rep = rma.sales_rep
    WHERE os.fetch_month = (SELECT MAX(fetch_month) FROM order_summary)
    GROUP BY os.sales_rep, rma.manager_name
    ORDER BY rma.manager_name, mtd_revenue DESC`);

  const spot = ['Kevin Green', 'Angeline Wu', 'Simon Wu'];
  console.log('\nSpot-check (SQL total_revenue vs rep email hero):');
  for (const rep of spot) {
    const row = rows.find(r => r.sales_rep === rep);
    const { html } = await buildRepEmailHtml(rep);
    const sql = row ? parseFloat(row.mtd_revenue) : 0;
    const hero = heroOf(html).replace(/[$,]/g, '');
    const match = Math.abs(sql - parseFloat(hero)) < 1;
    console.log(`  ${rep}: SQL=$${sql} hero=${heroOf(html)} match=${match ? 'YES' : 'NO'}`);
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
