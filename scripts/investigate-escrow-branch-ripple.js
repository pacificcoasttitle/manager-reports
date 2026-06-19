require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['1. officer_branches table schema',
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name='title_officer_branches' ORDER BY ordinal_position;`],
  ['2. All active officers in mapping table (any indicator of role?)',
    `SELECT * FROM title_officer_branches WHERE is_active = true ORDER BY branch, officer_name;`],
  ['3. May 2026 escrow officers — are they ALL in the mapping table?',
    `SELECT DISTINCT os.escrow_officer,
       tob.branch AS mapped_branch,
       CASE WHEN tob.officer_name IS NULL THEN 'NOT MAPPED' ELSE 'mapped' END AS status
     FROM order_summary os
     LEFT JOIN title_officer_branches tob
       ON tob.officer_name = os.escrow_officer AND tob.is_active = true
     WHERE os.fetch_month='2026-05' AND os.escrow_revenue > 0
       AND os.escrow_officer IS NOT NULL AND os.escrow_officer <> ''
     ORDER BY status, os.escrow_officer;`],
  ['4. ALL distinct escrow officers in last 5 months vs mapping',
    `SELECT DISTINCT os.escrow_officer,
       tob.branch AS mapped_branch,
       CASE WHEN tob.officer_name IS NULL THEN 'NOT MAPPED' ELSE 'mapped' END AS status
     FROM order_summary os
     LEFT JOIN title_officer_branches tob
       ON tob.officer_name = os.escrow_officer AND tob.is_active = true
     WHERE os.fetch_month >= '2026-01' AND os.escrow_revenue > 0
       AND os.escrow_officer IS NOT NULL AND os.escrow_officer <> ''
     ORDER BY status, os.escrow_officer;`],
  ['5. May 2026: file-number branch vs officer home branch — where do they differ?',
    `WITH file_branch AS (
       SELECT os.file_number, os.escrow_officer, os.escrow_revenue,
         CASE
           WHEN os.file_number LIKE '%-GLT' THEN 'Glendale'
           WHEN os.file_number LIKE '%-OCT' THEN 'Orange'
           WHEN os.file_number LIKE '%-PRV' THEN 'Porterville'
           WHEN os.file_number LIKE '%-ONT' THEN 'Inland Empire'
           ELSE 'Unknown'
         END AS file_branch,
         tob.branch AS officer_branch
       FROM order_summary os
       LEFT JOIN title_officer_branches tob
         ON tob.officer_name = os.escrow_officer AND tob.is_active = true
       WHERE os.fetch_month='2026-05' AND os.escrow_revenue > 0
     )
     SELECT file_branch, officer_branch, COUNT(*) AS files,
       ROUND(SUM(escrow_revenue)::numeric,2) AS revenue
     FROM file_branch
     GROUP BY file_branch, officer_branch
     ORDER BY file_branch, officer_branch;`],
  ['6. The specific May files where file_branch != officer_branch',
    `WITH file_branch AS (
       SELECT os.file_number, os.escrow_officer, os.sales_rep,
         ROUND(os.escrow_revenue::numeric,2) AS esc_rev,
         CASE
           WHEN os.file_number LIKE '%-GLT' THEN 'Glendale'
           WHEN os.file_number LIKE '%-OCT' THEN 'Orange'
           WHEN os.file_number LIKE '%-PRV' THEN 'Porterville'
           WHEN os.file_number LIKE '%-ONT' THEN 'Inland Empire'
           ELSE 'Unknown'
         END AS file_branch,
         tob.branch AS officer_branch
       FROM order_summary os
       LEFT JOIN title_officer_branches tob
         ON tob.officer_name = os.escrow_officer AND tob.is_active = true
       WHERE os.fetch_month='2026-05' AND os.escrow_revenue > 0
     )
     SELECT * FROM file_branch
     WHERE file_branch <> COALESCE(officer_branch, 'X')
     ORDER BY esc_rev DESC;`],
  ['7. Cross-month: how many files would shift branch under new rule (Jan-May)',
    `WITH file_branch AS (
       SELECT os.fetch_month, os.file_number, os.escrow_revenue,
         CASE
           WHEN os.file_number LIKE '%-GLT' THEN 'Glendale'
           WHEN os.file_number LIKE '%-OCT' THEN 'Orange'
           WHEN os.file_number LIKE '%-PRV' THEN 'Porterville'
           WHEN os.file_number LIKE '%-ONT' THEN 'Inland Empire'
           ELSE 'Unknown'
         END AS file_branch,
         tob.branch AS officer_branch
       FROM order_summary os
       LEFT JOIN title_officer_branches tob
         ON tob.officer_name = os.escrow_officer AND tob.is_active = true
       WHERE os.fetch_month >= '2026-01' AND os.escrow_revenue > 0
     )
     SELECT fetch_month,
       COUNT(*) FILTER (WHERE officer_branch IS NULL) AS unmapped_officer_files,
       COUNT(*) FILTER (WHERE officer_branch IS NOT NULL AND file_branch <> officer_branch) AS shifted_files,
       COUNT(*) FILTER (WHERE officer_branch IS NOT NULL AND file_branch = officer_branch) AS unchanged_files,
       ROUND(SUM(escrow_revenue) FILTER (WHERE officer_branch IS NOT NULL AND file_branch <> officer_branch)::numeric,2) AS shifted_revenue
     FROM file_branch
     GROUP BY fetch_month ORDER BY fetch_month;`],
  ['8. Are escrow officers ever assigned to a different branch than where they close most files? (consistency check)',
    `WITH per_officer_branch AS (
       SELECT escrow_officer,
         CASE
           WHEN file_number LIKE '%-GLT' THEN 'Glendale'
           WHEN file_number LIKE '%-OCT' THEN 'Orange'
           WHEN file_number LIKE '%-PRV' THEN 'Porterville'
           WHEN file_number LIKE '%-ONT' THEN 'Inland Empire'
           ELSE 'Unknown'
         END AS file_branch,
         COUNT(*) AS files
       FROM order_summary
       WHERE fetch_month >= '2026-01' AND escrow_revenue > 0
         AND escrow_officer IS NOT NULL AND escrow_officer <> ''
       GROUP BY escrow_officer, file_branch
     )
     SELECT pob.escrow_officer, tob.branch AS mapped_home_branch,
       pob.file_branch, pob.files
     FROM per_officer_branch pob
     LEFT JOIN title_officer_branches tob
       ON tob.officer_name = pob.escrow_officer AND tob.is_active = true
     ORDER BY pob.escrow_officer, pob.files DESC;`],
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
