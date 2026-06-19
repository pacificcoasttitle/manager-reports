require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['1. Confirm the gap',
    `SELECT
       ROUND(SUM(escrow_revenue)::numeric,2) AS actual_escrow_rev,
       ROUND(SUM(total_revenue)::numeric,2)  AS total_rev_for_escrow_orders,
       ROUND(SUM(title_revenue + underwriter_revenue)::numeric,2) AS title_uw_for_escrow_orders,
       COUNT(*) AS order_count
     FROM order_summary
     WHERE fetch_month='2026-05' AND escrow_revenue > 0;`],
  ['2. Corey Velasquez orders (May)',
    `SELECT file_number,
       ROUND(title_revenue::numeric,2) AS title_rev,
       ROUND(escrow_revenue::numeric,2) AS escrow_rev,
       ROUND(underwriter_revenue::numeric,2) AS uw_rev,
       ROUND(tsg_revenue::numeric,2) AS tsg_rev,
       ROUND(total_revenue::numeric,2) AS total_rev,
       sales_rep, escrow_officer
     FROM order_summary
     WHERE fetch_month='2026-05' AND sales_rep='Corey Velasquez' AND escrow_revenue>0
     ORDER BY escrow_revenue DESC;`],
  ['2b. Corey Velasquez sums',
    `SELECT COUNT(*) AS orders,
       ROUND(SUM(escrow_revenue)::numeric,2) AS sum_escrow,
       ROUND(SUM(total_revenue)::numeric,2)  AS sum_total
     FROM order_summary
     WHERE fetch_month='2026-05' AND sales_rep='Corey Velasquez' AND escrow_revenue>0;`],
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
