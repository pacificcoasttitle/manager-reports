require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['1. Title Revenue tab — branch by TITLE OFFICER mapping (May 2026)',
    `SELECT COALESCE(tob.branch,'Unassigned') AS branch,
       COUNT(*) AS orders,
       ROUND(SUM(os.title_revenue)::numeric,2) AS title_rev,
       ROUND(SUM(os.underwriter_revenue)::numeric,2) AS uw_rev,
       ROUND(SUM(os.tsg_revenue)::numeric,2) AS tsg_rev,
       ROUND(SUM(os.title_revenue+os.underwriter_revenue+os.tsg_revenue)::numeric,2) AS title_tab_total
     FROM order_summary os
     LEFT JOIN title_officer_branches tob ON os.title_officer=tob.officer_name AND tob.is_active=true
     WHERE os.fetch_month='2026-05'
       AND (os.title_revenue+os.underwriter_revenue+os.tsg_revenue)>0
     GROUP BY tob.branch ORDER BY title_tab_total DESC;`],
  ['2. Same total but by FILE NUMBER branch (May 2026)',
    `SELECT
       CASE
         WHEN file_number LIKE '%-GLT' THEN 'GLT'
         WHEN file_number LIKE '%-OCT' THEN 'OCT'
         WHEN file_number LIKE '%-ONT' THEN 'ONT'
         WHEN file_number LIKE '%-PRV' THEN 'PRV'
         WHEN file_number LIKE '%-TSG' OR file_number LIKE '99%' THEN 'TSG'
         ELSE 'Other'
       END AS file_branch,
       COUNT(*) AS orders,
       ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) AS title_uw_only,
       ROUND(SUM(tsg_revenue)::numeric,2) AS tsg_rev,
       ROUND(SUM(title_revenue+underwriter_revenue+tsg_revenue)::numeric,2) AS title_uw_tsg
     FROM order_summary
     WHERE fetch_month='2026-05'
       AND (title_revenue+underwriter_revenue+tsg_revenue)>0
     GROUP BY file_branch ORDER BY title_uw_tsg DESC;`],
  ['3. Grand total comparison',
    `SELECT
       ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) AS title_uw_only,
       ROUND(SUM(tsg_revenue)::numeric,2) AS tsg_only,
       ROUND(SUM(title_revenue+underwriter_revenue+tsg_revenue)::numeric,2) AS title_uw_tsg_combined,
       COUNT(*) AS orders
     FROM order_summary
     WHERE fetch_month='2026-05'
       AND (title_revenue+underwriter_revenue+tsg_revenue)>0;`],
  ['4. The "Other" / unmatched files in #2 (sanity)',
    `SELECT file_number, title_officer,
       ROUND((title_revenue+underwriter_revenue+tsg_revenue)::numeric,2) AS title_uw_tsg
     FROM order_summary
     WHERE fetch_month='2026-05'
       AND (title_revenue+underwriter_revenue+tsg_revenue)>0
       AND file_number NOT LIKE '%-GLT' AND file_number NOT LIKE '%-OCT'
       AND file_number NOT LIKE '%-ONT' AND file_number NOT LIKE '%-PRV'
       AND file_number NOT LIKE '%-TSG' AND file_number NOT LIKE '99%'
     ORDER BY title_uw_tsg DESC;`],
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const [name, sql] of Q) {
    console.log('\n=== ' + name + ' ===');
    try {
      const r = await c.query(sql);
      r.rows.length ? console.table(r.rows) : console.log('(no rows)');
    } catch (e) { console.log('ERROR:', e.message); }
  }
  await c.end();
})();
