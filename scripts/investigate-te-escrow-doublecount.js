require('dotenv').config();
const pool = require('../database/pool');

(async () => {
  const month = '2026-06';

  console.log('=== order_summary columns (revenue-related) ===');
  const cols = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'order_summary'
      AND (column_name ILIKE '%revenue%' OR column_name ILIKE '%escrow%' OR column_name ILIKE '%commission%' OR column_name = 'order_type' OR column_name = 'category')
    ORDER BY ordinal_position
  `);
  console.table(cols.rows);

  const hasCol = (n) => cols.rows.some(r => r.column_name === n);
  const commExpr = hasCol('commissionable_escrow') ? 'commissionable_escrow' : 'NULL::numeric';

  console.log('\n=== 1. T&E decomposition (sample, June) ===');
  const q1 = await pool.query(`
    SELECT file_number, sales_rep,
      ROUND(title_revenue::numeric,2) title,
      ROUND(underwriter_revenue::numeric,2) uw,
      ROUND(escrow_revenue::numeric,2) escrow,
      ROUND(tsg_revenue::numeric,2) tsg,
      ROUND(${commExpr}::numeric,2) comm_escrow,
      ROUND(total_revenue::numeric,2) total,
      ROUND((title_revenue+underwriter_revenue+escrow_revenue+tsg_revenue)::numeric,2) sum_of_parts
    FROM order_summary
    WHERE order_type='Title & Escrow' AND fetch_month=$1 AND escrow_revenue>0
    ORDER BY total_revenue DESC LIMIT 15
  `, [month]);
  console.table(q1.rows);

  console.log('\n=== 2. Aggregate discrepancy across all T&E (June) ===');
  const q2 = await pool.query(`
    SELECT COUNT(*)::int tne_orders,
      ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) title_uw_sum,
      ROUND(SUM(escrow_revenue)::numeric,2) escrow_sum,
      ROUND(SUM(tsg_revenue)::numeric,2) tsg_sum,
      ROUND(SUM(total_revenue)::numeric,2) total_sum,
      ROUND(SUM(title_revenue+underwriter_revenue+escrow_revenue+tsg_revenue)::numeric,2) parts_sum,
      ROUND(SUM(total_revenue-(title_revenue+underwriter_revenue+escrow_revenue+tsg_revenue))::numeric,2) discrepancy
    FROM order_summary
    WHERE order_type='Title & Escrow' AND fetch_month=$1
  `, [month]);
  console.table(q2.rows);

  console.log('\n=== 2b. Discrepancy across ALL orders (June, any order_type) ===');
  const q2b = await pool.query(`
    SELECT COUNT(*)::int orders,
      ROUND(SUM(total_revenue)::numeric,2) total_sum,
      ROUND(SUM(title_revenue+underwriter_revenue+escrow_revenue+tsg_revenue)::numeric,2) parts_sum,
      ROUND(SUM(total_revenue-(title_revenue+underwriter_revenue+escrow_revenue+tsg_revenue))::numeric,2) discrepancy
    FROM order_summary WHERE fetch_month=$1
  `, [month]);
  console.table(q2b.rows);

  console.log('\n=== 3. Sandra rep total composition (June) ===');
  const q3 = await pool.query(`
    SELECT sales_rep,
      ROUND(SUM(total_revenue)::numeric,2) rep_total_revenue,
      ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) title_only,
      ROUND(SUM(escrow_revenue)::numeric,2) escrow_portion,
      ROUND(SUM(tsg_revenue)::numeric,2) tsg_portion,
      ROUND(SUM(${commExpr})::numeric,2) commissionable_escrow
    FROM order_summary
    WHERE sales_rep='Sandra Millar' AND fetch_month=$1
    GROUP BY sales_rep
  `, [month]);
  console.table(q3.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
