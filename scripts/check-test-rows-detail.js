require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('\n=== open_orders: rows matching ANY test predicate (by which predicate) ===');
  const r1 = await c.query(`
    SELECT
      COUNT(*) FILTER (WHERE file_number ILIKE 'test%') AS file_test_pct,
      COUNT(*) FILTER (WHERE file_number ILIKE 'ar test%') AS file_ar_test,
      COUNT(*) FILTER (WHERE profile ILIKE '%test & training%') AS profile_test_training,
      COUNT(*) FILTER (WHERE profile ILIKE '%test%' AND profile NOT ILIKE '%test & training%') AS profile_other_test
    FROM open_orders
  `);
  console.table(r1.rows);

  console.log('\n=== open_orders: distinct profile values containing "test" ===');
  const r2 = await c.query(`
    SELECT profile, COUNT(*) AS rows
    FROM open_orders
    WHERE profile ILIKE '%test%'
    GROUP BY profile ORDER BY rows DESC
  `);
  console.table(r2.rows);

  console.log('\n=== open_orders: file_number patterns starting with TEST or AR TEST ===');
  const r3 = await c.query(`
    SELECT file_number, profile, open_month
    FROM open_orders
    WHERE file_number ILIKE 'test%' OR file_number ILIKE 'ar test%'
    ORDER BY open_month, file_number
    LIMIT 20
  `);
  console.table(r3.rows);

  console.log('\n=== open_orders: TOTAL test rows by open_month ===');
  const r4 = await c.query(`
    SELECT open_month,
      COUNT(*) AS test_rows
    FROM open_orders
    WHERE file_number ILIKE 'test%' OR file_number ILIKE 'ar test%' OR profile ILIKE '%test & training%'
    GROUP BY open_month ORDER BY open_month
  `);
  console.table(r4.rows);

  console.log('\n=== revenue_line_items: distinct test file numbers ===');
  const r5 = await c.query(`
    SELECT DISTINCT file_number FROM revenue_line_items
    WHERE file_number ILIKE 'test%' OR file_number ILIKE 'ar test%'
    ORDER BY file_number
  `);
  console.table(r5.rows);

  console.log('\n=== order_summary: test rows ===');
  const r6 = await c.query(`
    SELECT file_number, fetch_month, total_revenue
    FROM order_summary
    WHERE file_number ILIKE 'test%' OR file_number ILIKE 'ar test%'
    ORDER BY fetch_month, file_number
  `);
  console.table(r6.rows);

  await c.end();
})();
