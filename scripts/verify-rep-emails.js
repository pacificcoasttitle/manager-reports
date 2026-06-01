require('dotenv').config();
const { buildRepEmailHtml } = require('../lib/rep-email');
const pool = require('../database/pool');

const SAMPLE = ['Kevin Green', 'Angeline Wu', 'Sandra Millar'];

const pick = (html, label, re) => {
  const m = html.match(re);
  console.log(`    ${label}:`, m ? m[1].replace(/<[^>]+>/g, '').trim() : 'NOT FOUND');
};

(async () => {
  const { rows: mx } = await pool.query('SELECT MAX(fetch_month) m FROM order_summary');
  const ym = mx[0].m;

  // Step 7 cross-check truth
  const { rows: truth } = await pool.query(`
    SELECT sales_rep, COUNT(*) as mtd_orders, ROUND(SUM(total_revenue)::numeric,2) as mtd_rev
    FROM order_summary
    WHERE sales_rep = ANY($1) AND fetch_month = $2
    GROUP BY sales_rep ORDER BY mtd_rev DESC`, [SAMPLE, ym]);
  console.log(`SQL truth (fetch_month=${ym}):`);
  console.table(truth);

  for (const rep of SAMPLE) {
    console.log(`\n=== ${rep} ===`);
    const { html } = await buildRepEmailHtml(rep);
    pick(html, 'Hero MTD revenue', /Month-to-Date Revenue<\/div>\s*<div[^>]*>([^<]+)</);
    pick(html, 'Trend', /font-size:14px; font-weight:600;">([\s\S]*?)<\/div>/);
    pick(html, 'Rank badge', /(&#127942;[^<]+)</);
    pick(html, 'Progress fill', /width="(\d+%)" style="background-color:#f26b2b/);
  }
  await pool.end();
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
