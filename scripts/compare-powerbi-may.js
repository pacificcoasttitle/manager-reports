require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['1. Our Title Officer Production totals (May 2026)',
    `SELECT COALESCE(NULLIF(title_officer,''),'(blank)') AS title_officer,
       COUNT(*) AS orders,
       ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) AS our_total
     FROM order_summary
     WHERE fetch_month='2026-05' AND (title_revenue+underwriter_revenue)>0
     GROUP BY title_officer ORDER BY our_total DESC;`],
  ['2. Side-by-side vs PowerBI',
    `WITH our_data AS (
       SELECT COALESCE(NULLIF(title_officer,''),'(blank)') AS officer,
         ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) AS our_amount
       FROM order_summary
       WHERE fetch_month='2026-05' AND (title_revenue+underwriter_revenue)>0
       GROUP BY title_officer
     ),
     powerbi_data(officer, powerbi_amount) AS (VALUES
       ('(blank)', 2940.00),
       ('Clive Virata', 169717.00),
       ('Eddie LasMarias', 417085.00),
       ('Jim Jean', 212720.70),
       ('Rachel Barcena', 274855.10),
       ('Susan Dana', 26242.00)
     )
     SELECT COALESCE(o.officer, p.officer) AS officer,
       o.our_amount AS our_total,
       p.powerbi_amount AS powerbi_total,
       ROUND((COALESCE(o.our_amount,0) - COALESCE(p.powerbi_amount,0))::numeric,2) AS difference
     FROM our_data o
     FULL OUTER JOIN powerbi_data p ON o.officer = p.officer
     ORDER BY ABS(COALESCE(o.our_amount,0) - COALESCE(p.powerbi_amount,0)) DESC;`],
  ['3. Grand totals',
    `SELECT 'Our total' AS source,
       ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) AS total,
       COUNT(*) AS orders
     FROM order_summary
     WHERE fetch_month='2026-05' AND (title_revenue+underwriter_revenue)>0
     UNION ALL
     SELECT 'PowerBI total', 1103559.80, NULL;`],
  ['4. Blank-officer orders with title+UW revenue in May',
    `SELECT file_number, title_officer, sales_rep,
       ROUND((title_revenue+underwriter_revenue)::numeric,2) AS title_uw,
       ROUND(total_revenue::numeric,2) AS total_rev,
       category, order_type
     FROM order_summary
     WHERE fetch_month='2026-05'
       AND (title_officer IS NULL OR title_officer='')
       AND (title_revenue+underwriter_revenue)>0;`],
  ['5. Distinct title officers in our May data (case/whitespace check)',
    `SELECT DISTINCT title_officer FROM order_summary
     WHERE fetch_month='2026-05' AND (title_revenue+underwriter_revenue)>0
     ORDER BY title_officer;`],
  ['6. Sanity: total revenue across ALL columns for May',
    `SELECT
       ROUND(SUM(title_revenue)::numeric,2) AS title_only,
       ROUND(SUM(underwriter_revenue)::numeric,2) AS uw_only,
       ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) AS title_plus_uw,
       ROUND(SUM(escrow_revenue)::numeric,2) AS escrow,
       ROUND(SUM(tsg_revenue)::numeric,2) AS tsg,
       ROUND(SUM(total_revenue)::numeric,2) AS total_rev,
       COUNT(*) AS rows_in_month
     FROM order_summary WHERE fetch_month='2026-05';`],
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
