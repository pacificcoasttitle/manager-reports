require('dotenv').config();
const { buildOfficerEmailHtml } = require('../lib/officer-email');
const { buildManagerEmailHtml } = require('../lib/manager-email');
const pool = require('../database/pool');

const pick = (html, label, re) => {
  const m = html.match(re);
  console.log(`  ${label}:`, m ? m[1].replace(/<[^>]+>/g, '').trim() : 'NOT FOUND');
};

(async () => {
  console.log('=== Eddie LasMarias (officer) ===');
  const o = await buildOfficerEmailHtml('Eddie LasMarias');
  pick(o.html, 'Hero MTD revenue', /Month-to-Date Revenue<\/div>\s*<div[^>]*>([^<]+)</);
  pick(o.html, 'Trend', /font-size:14px; font-weight:600;">([\s\S]*?)<\/div>/);
  pick(o.html, 'Rank badge', /(&#127942;[^<]+)</);
  pick(o.html, 'Progress fill', /width="(\d+%)" style="background-color:#f26b2b/);

  console.log('\n=== Team Meza (manager) ===');
  const m = await buildManagerEmailHtml('Team Meza');
  pick(m.html, 'Hero team revenue', /Month-to-Date<\/div>\s*<div[^>]*>([^<]+)</);
  pick(m.html, 'Trend', /font-size:14px; font-weight:600;">([\s\S]*?)<\/div>/);
  pick(m.html, 'Rank badge', /(&#127942;[^<]+)</);
  pick(m.html, 'Progress fill', /width="(\d+%)" style="background-color:#f26b2b/);
  // Team total revenue (last orange figure in reps table)
  const totals = [...m.html.matchAll(/color:#f26b2b[^>]*>([^<]+)</g)].map(x => x[1]);
  console.log('  Orange figures:', totals.join(' | '));

  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
