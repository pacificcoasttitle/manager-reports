require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['1. Total open orders in May 2026',
    `SELECT COUNT(*) AS total_opens, COUNT(DISTINCT file_number) AS unique_files
     FROM open_orders WHERE open_month='2026-05';`],
  ['2. By branch — file number suffix',
    `SELECT
       CASE
         WHEN file_number LIKE '%-GLT' THEN 'Glendale (GLT)'
         WHEN file_number LIKE '%-OCT' THEN 'Orange (OCT)'
         WHEN file_number LIKE '%-ONT' THEN 'Inland Empire (ONT)'
         WHEN file_number LIKE '%-PRV' THEN 'Porterville (PRV)'
         WHEN file_number LIKE '%-TSG' OR file_number LIKE '99%' THEN 'TSG'
         ELSE 'Other'
       END AS branch,
       COUNT(*) AS open_count
     FROM open_orders WHERE open_month='2026-05'
     GROUP BY branch ORDER BY open_count DESC;`],
  ['3. By profile (SoftPro / PowerBI dimension)',
    `SELECT COALESCE(NULLIF(profile,''),'(blank)') AS profile, COUNT(*) AS open_count
     FROM open_orders WHERE open_month='2026-05'
     GROUP BY profile ORDER BY open_count DESC;`],
  ['4. By stored category',
    `SELECT COALESCE(NULLIF(category,''),'(blank)') AS category, COUNT(*) AS open_count
     FROM open_orders WHERE open_month='2026-05'
     GROUP BY category ORDER BY open_count DESC;`],
  ['5. By derived category (order_type + trans_type)',
    `SELECT
       CASE
         WHEN order_type='Trustee Sale Guarantee' THEN 'TSG'
         WHEN order_type IN ('Title & Escrow','Escrow Only') THEN 'Escrow'
         WHEN order_type='Title only' AND trans_type='Purchase' THEN 'Purchase'
         WHEN order_type='Title only' AND trans_type='Refinance' THEN 'Refinance'
         ELSE 'Other'
       END AS derived_category,
       order_type, trans_type, COUNT(*) AS open_count
     FROM open_orders WHERE open_month='2026-05'
     GROUP BY derived_category, order_type, trans_type
     ORDER BY open_count DESC;`],
  ['6. Branch x Category cross-tab',
    `SELECT
       CASE
         WHEN file_number LIKE '%-GLT' THEN 'Glendale'
         WHEN file_number LIKE '%-OCT' THEN 'Orange'
         WHEN file_number LIKE '%-ONT' THEN 'Inland Empire'
         WHEN file_number LIKE '%-PRV' THEN 'Porterville'
         WHEN file_number LIKE '%-TSG' OR file_number LIKE '99%' THEN 'TSG'
         ELSE 'Other'
       END AS branch,
       COALESCE(NULLIF(category,''),'(blank)') AS category,
       COUNT(*) AS opens
     FROM open_orders WHERE open_month='2026-05'
     GROUP BY branch, category ORDER BY branch, category;`],
  ['7. Exclusion / quality flags',
    `SELECT
       CASE
         WHEN file_number ILIKE 'test%' OR file_number ILIKE 'ar test%' THEN 'TEST orders'
         WHEN profile ILIKE '%test%' OR profile ILIKE '%training%' THEN 'Test profile'
         WHEN category IS NULL OR category='' THEN 'Blank category'
         WHEN category='Unknown' THEN 'Unknown category'
         ELSE 'Normal'
       END AS flag,
       COUNT(*) AS count
     FROM open_orders WHERE open_month='2026-05'
     GROUP BY flag ORDER BY count DESC;`],
  ['8. What the Title Revenue tab counts as MTD opens',
    `SELECT
       COUNT(*) AS total_opens,
       COUNT(*) FILTER (WHERE LOWER(order_type) IN ('title only','title & escrow')) AS title_only_and_tne,
       COUNT(*) FILTER (WHERE LOWER(order_type)='title only' AND LOWER(trans_type)='purchase') AS purchase_opens,
       COUNT(*) FILTER (WHERE LOWER(order_type)='title only' AND LOWER(trans_type)='refinance') AS refi_opens,
       COUNT(*) FILTER (WHERE LOWER(order_type) IN ('title & escrow','escrow only')) AS escrow_opens,
       COUNT(*) FILTER (WHERE LOWER(order_type)='trustee sale guarantee') AS tsg_opens
     FROM open_orders WHERE open_month='2026-05';`],
  ['9. Bonus: column metadata for open_orders',
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name='open_orders' ORDER BY ordinal_position;`],
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
