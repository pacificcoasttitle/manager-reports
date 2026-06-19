require('dotenv').config();
const pool = require('../database/pool');
(async () => {
  console.log('=== 1. open_orders categorization columns ===');
  console.table((await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='open_orders' AND column_name IN ('trans_type','order_type','category','open_month','sales_rep')
    ORDER BY ordinal_position`)).rows);

  console.log('\n=== 1b. Does open_orders have a category column at all? ===');
  console.table((await pool.query(`
    SELECT COUNT(*) FILTER (WHERE column_name='category') as has_category
    FROM information_schema.columns WHERE table_name='open_orders'`)).rows);

  console.log('\n=== 3. open_orders by trans_type x order_type (June) ===');
  console.table((await pool.query(`
    SELECT trans_type, order_type, COUNT(*)::int as opens
    FROM open_orders WHERE open_month='2026-06'
    GROUP BY trans_type, order_type ORDER BY opens DESC`)).rows);

  // Canonical categorizeOrder() replicated exactly: TSG -> Escrow -> (title only: purchase/refi/other) -> Unknown
  const catExpr = `
    CASE
      WHEN LOWER(TRIM(order_type)) = 'trustee sale guarantee' THEN 'tsg'
      WHEN LOWER(TRIM(order_type)) IN ('title & escrow','escrow only') THEN 'escrow'
      WHEN LOWER(TRIM(order_type)) = 'title only' AND LOWER(TRIM(trans_type)) = 'purchase' THEN 'purchase'
      WHEN LOWER(TRIM(order_type)) = 'title only' AND LOWER(TRIM(trans_type)) = 'refinance' THEN 'refinance'
      ELSE 'other'
    END`;

  console.log('\n=== 3b. What does the EXISTING open_orders.category column contain? (June) ===');
  console.table((await pool.query(`
    SELECT category, COUNT(*)::int as opens FROM open_orders WHERE open_month='2026-06'
    GROUP BY category ORDER BY opens DESC`)).rows);

  console.log('\n=== 3c. Existing category across months ===');
  console.table((await pool.query(`
    SELECT open_month,
      COUNT(*) FILTER (WHERE category='Purchase')::int as purchase,
      COUNT(*) FILTER (WHERE category='Refinance')::int as refinance,
      COUNT(*) FILTER (WHERE category='Escrow')::int as escrow,
      COUNT(*) FILTER (WHERE category='TSG')::int as tsg,
      COUNT(*) FILTER (WHERE category NOT IN ('Purchase','Refinance','Escrow','TSG') OR category IS NULL)::int as other,
      COUNT(*)::int as total_opens
    FROM open_orders WHERE open_month >= '2025-08'
    GROUP BY open_month ORDER BY open_month`)).rows);

  console.log('\n=== 4. Canonical re-derivation (June) — is there residual other? ===');
  console.table((await pool.query(`
    SELECT cat as category, COUNT(*)::int as opens FROM (
      SELECT ${catExpr} as cat FROM open_orders WHERE open_month='2026-06'
    ) t GROUP BY cat ORDER BY opens DESC`)).rows);

  console.log('\n=== 5b. What IS the residual other bucket? (canonical re-derivation) ===');
  console.table((await pool.query(`
    SELECT order_type, trans_type, COUNT(*)::int as opens FROM (
      SELECT order_type, trans_type, ${catExpr} as cat FROM open_orders WHERE open_month >= '2025-08'
    ) t WHERE cat='other'
    GROUP BY order_type, trans_type ORDER BY opens DESC`)).rows);

  console.log('\n=== 6. Does existing category match canonical re-derivation? (mismatch count) ===');
  console.table((await pool.query(`
    SELECT COUNT(*)::int as mismatches FROM (
      SELECT category,
        ${catExpr.replace(/'tsg'/, "'TSG'").replace(/'escrow'/, "'Escrow'").replace(/'purchase'/, "'Purchase'").replace(/'refinance'/, "'Refinance'").replace(/'other'/, "'Other'")} as derived
      FROM open_orders WHERE open_month >= '2025-08'
    ) t WHERE COALESCE(category,'') IS DISTINCT FROM derived`)).rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
