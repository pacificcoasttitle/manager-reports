require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  // For each order, take one non-empty full_address from its line items (same file+month)
  const res = await pool.query(`
    UPDATE order_summary os
    SET full_address = sub.full_address
    FROM (
      SELECT DISTINCT ON (file_number, fetch_month) file_number, fetch_month, full_address
      FROM revenue_line_items
      WHERE full_address IS NOT NULL AND full_address != ''
      ORDER BY file_number, fetch_month, full_address
    ) sub
    WHERE os.file_number = sub.file_number
      AND os.fetch_month = sub.fetch_month
      AND (os.full_address IS NULL OR os.full_address = '')
  `);
  console.log(`Backfilled full_address on ${res.rowCount} order_summary rows.`);

  const { rows } = await pool.query(`
    SELECT fetch_month,
           COUNT(*) FILTER (WHERE full_address IS NOT NULL AND full_address != '') as has_addr,
           COUNT(*) as total
    FROM order_summary
    GROUP BY fetch_month ORDER BY fetch_month DESC LIMIT 6`);
  console.table(rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
