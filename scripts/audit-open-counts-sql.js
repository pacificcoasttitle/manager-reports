require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['1. Title Revenue tab — expected opens (Title only + T&E)',
    `SELECT
       CASE
         WHEN order_type='Title only' AND trans_type='Purchase' THEN 'Purchase'
         WHEN order_type='Title only' AND trans_type='Refinance' THEN 'Refinance'
         WHEN order_type='Title & Escrow' AND trans_type='Purchase' THEN 'Purchase (T&E)'
         WHEN order_type='Title & Escrow' AND trans_type='Refinance' THEN 'Refinance (T&E)'
         ELSE 'Other'
       END AS bucket,
       COUNT(*) AS opens
     FROM open_orders
     WHERE open_month='2026-05'
       AND order_type IN ('Title only','Title & Escrow')
     GROUP BY bucket ORDER BY bucket;`],
  ['2. Title Officer Production — expected opens per officer (Title only + T&E)',
    `SELECT COALESCE(tob.branch,'Unassigned') AS branch,
       oo.title_officer,
       COUNT(*) FILTER (WHERE oo.order_type='Title only' AND oo.trans_type='Purchase') AS purchase_opens,
       COUNT(*) FILTER (WHERE oo.order_type='Title only' AND oo.trans_type='Refinance') AS refi_opens,
       COUNT(*) FILTER (WHERE oo.order_type='Title & Escrow') AS tne_opens,
       COUNT(*) AS total_opens
     FROM open_orders oo
     LEFT JOIN title_officer_branches tob ON oo.title_officer=tob.officer_name AND tob.is_active=true
     WHERE oo.open_month='2026-05' AND oo.order_type IN ('Title only','Title & Escrow')
     GROUP BY tob.branch, oo.title_officer ORDER BY total_opens DESC;`],
  ['3. Escrow Production — expected opens by file branch x sales_rep (T&E + Escrow Only)',
    `WITH x AS (
       SELECT file_number, sales_rep,
         CASE
           WHEN file_number LIKE '%-GLT' THEN 'Glendale'
           WHEN file_number LIKE '%-OCT' THEN 'Orange'
           WHEN file_number LIKE '%-ONT' THEN 'Inland Empire'
           WHEN file_number LIKE '%-PRV' THEN 'Porterville'
           WHEN file_number LIKE '%-TSG' OR file_number LIKE '99%' THEN 'TSG'
           ELSE 'Other'
         END AS branch
       FROM open_orders
       WHERE open_month='2026-05' AND order_type IN ('Title & Escrow','Escrow Only'))
     SELECT branch, sales_rep, COUNT(*) AS opens
     FROM x GROUP BY branch, sales_rep ORDER BY branch, opens DESC;`],
  ['4. TSG opens (May)',
    `SELECT COUNT(*) AS tsg_opens FROM open_orders
     WHERE open_month='2026-05' AND order_type='Trustee Sale Guarantee';`],
  ['5. R-14 Branches — total opens by file branch (all categories)',
    `WITH x AS (
       SELECT file_number,
         CASE
           WHEN file_number LIKE '%-GLT' THEN 'Glendale'
           WHEN file_number LIKE '%-OCT' THEN 'Orange'
           WHEN file_number LIKE '%-ONT' THEN 'Inland Empire'
           WHEN file_number LIKE '%-PRV' THEN 'Porterville'
           WHEN file_number LIKE '%-TSG' OR file_number LIKE '99%' THEN 'TSG'
           ELSE 'Other'
         END AS branch
       FROM open_orders WHERE open_month='2026-05')
     SELECT branch, COUNT(*) AS opens FROM x GROUP BY branch ORDER BY opens DESC;`],
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
