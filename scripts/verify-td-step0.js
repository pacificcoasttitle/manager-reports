require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  console.log('=== 1. open_orders columns ===');
  const { rows: cols } = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'open_orders'
    ORDER BY ordinal_position`);
  console.table(cols);

  const { rows: mxOpen } = await pool.query('SELECT MAX(open_month) m FROM open_orders');
  const openMonth = mxOpen[0].m;
  console.log('\nMAX open_month:', openMonth);

  console.log('\n=== 2. trans_type on open_orders (latest month) ===');
  const { rows: trans } = await pool.query(`
    SELECT trans_type, COUNT(*)::int as cnt
    FROM open_orders
    WHERE open_month = $1
    GROUP BY trans_type
    ORDER BY cnt DESC`, [openMonth]);
  console.table(trans);

  console.log('\n=== 2b. order_type on open_orders (latest month) ===');
  const { rows: ot } = await pool.query(`
    SELECT order_type, COUNT(*)::int as cnt
    FROM open_orders
    WHERE open_month = $1
    GROUP BY order_type
    ORDER BY cnt DESC`, [openMonth]);
  console.table(ot);

  const { rows: mxClose } = await pool.query('SELECT MAX(fetch_month) m FROM order_summary');
  const fetchMonth = mxClose[0].m;
  console.log('\nMAX fetch_month:', fetchMonth);

  console.log('\n=== 3. category on order_summary (latest month) ===');
  const { rows: cat } = await pool.query(`
    SELECT category, COUNT(*)::int as cnt
    FROM order_summary
    WHERE fetch_month = $1
    GROUP BY category
    ORDER BY cnt DESC`, [fetchMonth]);
  console.table(cat);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
