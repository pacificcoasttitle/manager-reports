require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['2. By branch — file number suffix (fixed)',
    `WITH x AS (
       SELECT file_number,
         CASE
           WHEN file_number LIKE '%-GLT' THEN 'Glendale (GLT)'
           WHEN file_number LIKE '%-OCT' THEN 'Orange (OCT)'
           WHEN file_number LIKE '%-ONT' THEN 'Inland Empire (ONT)'
           WHEN file_number LIKE '%-PRV' THEN 'Porterville (PRV)'
           WHEN file_number LIKE '%-TSG' OR file_number LIKE '99%' THEN 'TSG'
           ELSE 'Other'
         END AS branch
       FROM open_orders WHERE open_month='2026-05')
     SELECT branch, COUNT(*) AS open_count
     FROM x GROUP BY branch ORDER BY open_count DESC;`],
  ['6. Branch x Category cross-tab (fixed)',
    `WITH x AS (
       SELECT file_number, category,
         CASE
           WHEN file_number LIKE '%-GLT' THEN 'Glendale'
           WHEN file_number LIKE '%-OCT' THEN 'Orange'
           WHEN file_number LIKE '%-ONT' THEN 'Inland Empire'
           WHEN file_number LIKE '%-PRV' THEN 'Porterville'
           WHEN file_number LIKE '%-TSG' OR file_number LIKE '99%' THEN 'TSG'
           ELSE 'Other'
         END AS branch
       FROM open_orders WHERE open_month='2026-05')
     SELECT branch, COALESCE(NULLIF(category,''),'(blank)') AS category, COUNT(*) AS opens
     FROM x GROUP BY branch, category ORDER BY branch, category;`],
  ['10. open_orders.branch column — distinct values + counts',
    `SELECT COALESCE(NULLIF(branch,''),'(blank)') AS branch_col, COUNT(*) AS opens
     FROM open_orders WHERE open_month='2026-05'
     GROUP BY branch ORDER BY opens DESC;`],
  ['11. Cross-check: stored branch vs file-suffix branch',
    `WITH x AS (
       SELECT file_number, COALESCE(NULLIF(branch,''),'(blank)') AS stored_branch,
         CASE
           WHEN file_number LIKE '%-GLT' THEN 'Glendale'
           WHEN file_number LIKE '%-OCT' THEN 'Orange'
           WHEN file_number LIKE '%-ONT' THEN 'Inland Empire'
           WHEN file_number LIKE '%-PRV' THEN 'Porterville'
           WHEN file_number LIKE '%-TSG' OR file_number LIKE '99%' THEN 'TSG'
           ELSE 'Other'
         END AS suffix_branch
       FROM open_orders WHERE open_month='2026-05')
     SELECT stored_branch, suffix_branch, COUNT(*) AS opens
     FROM x GROUP BY stored_branch, suffix_branch
     ORDER BY suffix_branch, opens DESC;`],
  ['12. The 1 TEST order (sanity)',
    `SELECT file_number, profile, category, order_type, trans_type, sales_rep, received_date
     FROM open_orders
     WHERE open_month='2026-05'
       AND (file_number ILIKE 'test%' OR file_number ILIKE 'ar test%' OR profile ILIKE '%test%' OR profile ILIKE '%training%');`],
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
