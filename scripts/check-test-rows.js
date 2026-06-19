require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(`
    SELECT 'revenue_line_items' AS tbl, COUNT(*) AS test_rows
    FROM revenue_line_items WHERE file_number ILIKE 'test%' OR file_number ILIKE 'ar test%'
    UNION ALL
    SELECT 'order_summary', COUNT(*) FROM order_summary
    WHERE file_number ILIKE 'test%' OR file_number ILIKE 'ar test%'
    UNION ALL
    SELECT 'open_orders', COUNT(*) FROM open_orders
    WHERE file_number ILIKE 'test%' OR file_number ILIKE 'ar test%' OR profile ILIKE '%test & training%'
  `);
  console.table(r.rows);
  await c.end();
})();
