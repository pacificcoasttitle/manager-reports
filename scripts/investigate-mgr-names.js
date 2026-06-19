require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  for (const term of ['Israel', 'Glendale', 'Lopez']) {
    const { rows: os } = await pool.query(
      "SELECT DISTINCT sales_rep, '<order_summary>' src FROM order_summary WHERE sales_rep ILIKE $1", [`%${term}%`]);
    const { rows: oo } = await pool.query(
      "SELECT DISTINCT sales_rep, '<open_orders>' src FROM open_orders WHERE sales_rep ILIKE $1", [`%${term}%`]);
    console.log(`\n=== '${term}' ===`);
    console.table([...os, ...oo]);
  }
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
