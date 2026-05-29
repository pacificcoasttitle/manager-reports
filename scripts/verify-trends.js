require('dotenv').config();
const pool = require('../database/pool');
const reports = require('../lib/reports');

(async () => {
  const none = await reports.trends({ product: 'all', breakdown: 'none' });
  console.log('--- breakdown=none, product=all ---');
  console.log('months:', none.revenue.data.length, 'series:', none.revenue.series);
  const last = none.revenue.data[none.revenue.data.length - 1];
  console.log('latest revenue row:', last);
  console.log('latest opens:', none.openOrders.data[none.openOrders.data.length - 1]);
  console.log('latest closes:', none.closedOrders.data[none.closedOrders.data.length - 1]);
  console.log('kpi:', none.kpi);

  const branch = await reports.trends({ product: 'all', breakdown: 'branch' });
  console.log('\n--- breakdown=branch ---');
  console.log('revenue series:', branch.revenue.series);

  const product = await reports.trends({ product: 'all', breakdown: 'product' });
  console.log('\n--- breakdown=product ---');
  console.log('revenue series:', product.revenue.series);

  const refi = await reports.trends({ product: 'Refinance', breakdown: 'none' });
  console.log('\n--- product=Refinance (KPI $5 fix check) ---');
  console.log('kpi:', refi.kpi);
  console.log('latest revenue row:', refi.revenue.data[refi.revenue.data.length - 1]);

  // Cross-check latest month total revenue vs reconciliation-style grand total
  const { rows } = await pool.query(
    `SELECT ROUND(SUM(total_revenue)::numeric,2) v FROM order_summary
     WHERE fetch_month=$1 AND file_number NOT ILIKE 'test%' AND file_number NOT ILIKE 'ar test%'`,
    [last.month]
  );
  console.log(`\nReconcile check: trends ${last.month} Total=${last.Total} vs SQL grand=${rows[0].v}`,
    Number(last.Total) === Number(rows[0].v) ? 'MATCH' : 'DIFF');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
