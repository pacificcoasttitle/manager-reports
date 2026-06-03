require('dotenv').config();
const { buildRepEmailHtml } = require('../lib/rep-email');
const { buildOfficerEmailHtml } = require('../lib/officer-email');
const pool = require('../database/pool');

const hero = (html) => {
  const m = html.match(/Month-to-Date Revenue<\/div>\s*<div[^>]*>([^<]+)</);
  return m ? m[1].trim() : '?';
};
const closingsTotal = (html) => {
  // last orange figure inside the closings Total row
  const m = html.match(/>Total<\/td>\s*<td align="right"[^>]*color:#f26b2b[^>]*>([^<]+)</);
  return m ? m[1].trim() : '(no closings table)';
};
const fileCount = (html) => {
  const m = html.match(/(\d+) files? &nbsp;/);
  return m ? m[1] : '?';
};

(async () => {
  for (const rep of ['Kevin Green']) {
    const { html } = await buildRepEmailHtml(rep);
    console.log(`REP ${rep}: hero=${hero(html)} | closings total=${closingsTotal(html)} | files=${fileCount(html)}`);
  }
  for (const off of ['Eddie LasMarias']) {
    const { html } = await buildOfficerEmailHtml(off);
    console.log(`OFFICER ${off}: hero=${hero(html)} | closings total=${closingsTotal(html)} | files=${fileCount(html)}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
