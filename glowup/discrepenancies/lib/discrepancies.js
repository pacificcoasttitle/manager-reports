const pool = require('../database/pool');

async function runDiscrepancyChecks(month, year) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorDate = new Date(year, month - 2, 1);
  const priorYearMonth = `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, '0')}`;
  
  const monthStart = `${yearMonth}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  const checks = [];

  // =============================================
  // CRITICAL — Revenue Anomalies
  // =============================================

  // 1. Closed orders with $0 revenue
  try {
    const { rows } = await pool.query(`
      SELECT file_number, branch, category, sales_rep, transaction_date::text
      FROM order_summary
      WHERE fetch_month = $1 AND total_revenue = 0
      ORDER BY transaction_date DESC
    `, [yearMonth]);
    
    if (rows.length > 0) {
      checks.push({
        id: 'zero-revenue',
        severity: 'critical',
        title: 'Closed Orders with $0 Revenue',
        description: `${rows.length} orders were sent to accounting but have zero revenue. These may be missing bill codes or data sync errors.`,
        count: rows.length,
        details: rows.slice(0, 20),
        columns: ['file_number', 'branch', 'category', 'sales_rep', 'transaction_date']
      });
    }
  } catch (e) { console.error('Check zero-revenue failed:', e.message); }

  // 2. Unusually high revenue orders (> $10,000)
  try {
    const { rows } = await pool.query(`
      SELECT file_number, branch, category, sales_rep, total_revenue, transaction_date::text
      FROM order_summary
      WHERE fetch_month = $1 AND total_revenue > 10000
      ORDER BY total_revenue DESC
    `, [yearMonth]);
    
    if (rows.length > 0) {
      checks.push({
        id: 'high-revenue',
        severity: 'warning',
        title: 'High Revenue Orders (> $10,000)',
        description: `${rows.length} orders have revenue exceeding $10,000. Verify these are correct and not data entry errors.`,
        count: rows.length,
        details: rows.slice(0, 20),
        columns: ['file_number', 'branch', 'category', 'sales_rep', 'total_revenue', 'transaction_date']
      });
    }
  } catch (e) { console.error('Check high-revenue failed:', e.message); }

  // 3. Title & Escrow orders missing escrow revenue
  try {
    const { rows } = await pool.query(`
      SELECT file_number, branch, sales_rep, title_revenue, escrow_revenue, total_revenue, transaction_date::text
      FROM order_summary
      WHERE fetch_month = $1
        AND order_type = 'Title & Escrow'
        AND (escrow_revenue = 0 OR escrow_revenue IS NULL)
        AND total_revenue > 0
      ORDER BY total_revenue DESC
    `, [yearMonth]);
    
    if (rows.length > 0) {
      checks.push({
        id: 'missing-escrow-fee',
        severity: 'critical',
        title: 'T&E Orders Missing Escrow Revenue',
        description: `${rows.length} "Title & Escrow" orders have title revenue but $0 escrow revenue. The escrow fee may not have been billed.`,
        count: rows.length,
        details: rows.slice(0, 20),
        columns: ['file_number', 'branch', 'sales_rep', 'title_revenue', 'escrow_revenue', 'total_revenue', 'transaction_date']
      });
    }
  } catch (e) { console.error('Check missing-escrow-fee failed:', e.message); }

  // =============================================
  // DATA INTEGRITY
  // =============================================

  // 4. Closed orders not found in open_orders
  try {
    const { rows } = await pool.query(`
      SELECT os.file_number, os.branch, os.category, os.sales_rep, os.transaction_date::text
      FROM order_summary os
      LEFT JOIN open_orders oo ON os.file_number = oo.file_number
      WHERE os.fetch_month = $1 AND oo.file_number IS NULL
      ORDER BY os.transaction_date DESC
    `, [yearMonth]);
    
    if (rows.length > 0) {
      checks.push({
        id: 'closed-no-open',
        severity: 'warning',
        title: 'Closed Orders Never Opened',
        description: `${rows.length} orders have revenue but don't appear in the open orders data. They may have been opened before our tracking started, or the open orders import is incomplete.`,
        count: rows.length,
        details: rows.slice(0, 20),
        columns: ['file_number', 'branch', 'category', 'sales_rep', 'transaction_date']
      });
    }
  } catch (e) { console.error('Check closed-no-open failed:', e.message); }

  // 5. Orders with Unknown/missing branch
  try {
    const { rows } = await pool.query(`
      SELECT file_number, branch, category, sales_rep, total_revenue, transaction_date::text
      FROM order_summary
      WHERE fetch_month = $1 AND (branch IS NULL OR branch = '' OR branch = 'Unknown')
      ORDER BY total_revenue DESC
    `, [yearMonth]);
    
    if (rows.length > 0) {
      checks.push({
        id: 'unknown-branch',
        severity: 'critical',
        title: 'Orders with Unknown Branch',
        description: `${rows.length} orders have unrecognized file number prefixes and are excluded from branch reports. Revenue is being lost from reports.`,
        count: rows.length,
        details: rows.slice(0, 20),
        columns: ['file_number', 'branch', 'category', 'sales_rep', 'total_revenue', 'transaction_date']
      });
    }
  } catch (e) { console.error('Check unknown-branch failed:', e.message); }

  // 6. Missing personnel on closed orders
  try {
    const { rows } = await pool.query(`
      SELECT file_number, branch, category, 
        CASE WHEN sales_rep IS NULL OR sales_rep = '' THEN 'Missing Sales Rep' ELSE '' END as missing_sales_rep,
        CASE WHEN title_officer IS NULL OR title_officer = '' THEN 'Missing Title Officer' ELSE '' END as missing_title_officer,
        total_revenue, transaction_date::text
      FROM order_summary
      WHERE fetch_month = $1 AND total_revenue > 0
        AND ((sales_rep IS NULL OR sales_rep = '') OR (title_officer IS NULL OR title_officer = ''))
      ORDER BY total_revenue DESC
    `, [yearMonth]);
    
    if (rows.length > 0) {
      checks.push({
        id: 'missing-personnel',
        severity: 'warning',
        title: 'Closed Orders Missing Personnel',
        description: `${rows.length} closed orders are missing a sales rep or title officer assignment. These orders won't appear in the R-14 or Title Officer reports.`,
        count: rows.length,
        details: rows.slice(0, 20),
        columns: ['file_number', 'branch', 'category', 'missing_sales_rep', 'missing_title_officer', 'total_revenue', 'transaction_date']
      });
    }
  } catch (e) { console.error('Check missing-personnel failed:', e.message); }

  // =============================================
  // PERSONNEL — Performance Flags
  // =============================================

  // 7. Reps with closing ratio below 25%
  try {
    const closingStart = new Date(year, month - 5, 1);
    const closingStartStr = `${closingStart.getFullYear()}-${String(closingStart.getMonth() + 1).padStart(2, '0')}-01`;

    const { rows } = await pool.query(`
      WITH opened AS (
        SELECT sales_rep, COUNT(*) as open_cnt
        FROM open_orders
        WHERE received_date >= $1 AND received_date <= $2
          AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
      ),
      closed AS (
        SELECT sales_rep, COUNT(*) as close_cnt
        FROM order_summary
        WHERE transaction_date >= $1 AND transaction_date <= $2
          AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
      )
      SELECT o.sales_rep, o.open_cnt, COALESCE(c.close_cnt, 0) as close_cnt,
        ROUND(COALESCE(c.close_cnt, 0)::numeric / NULLIF(o.open_cnt, 0) * 100, 1) as ratio
      FROM opened o
      LEFT JOIN closed c ON o.sales_rep = c.sales_rep
      WHERE o.open_cnt >= 10
        AND (COALESCE(c.close_cnt, 0)::numeric / NULLIF(o.open_cnt, 0) * 100) < 25
      ORDER BY ratio ASC
    `, [closingStartStr, monthEnd]);

    if (rows.length > 0) {
      checks.push({
        id: 'low-closing-ratio',
        severity: 'warning',
        title: 'Reps with Closing Ratio Below 25%',
        description: `${rows.length} sales reps have a closing ratio under 25% over the last 4 months (minimum 10 orders). This may indicate pipeline issues or stale orders.`,
        count: rows.length,
        details: rows,
        columns: ['sales_rep', 'open_cnt', 'close_cnt', 'ratio']
      });
    }
  } catch (e) { console.error('Check low-closing-ratio failed:', e.message); }

  // 8. Reps with closing ratio above 100%
  try {
    const closingStart = new Date(year, month - 5, 1);
    const closingStartStr = `${closingStart.getFullYear()}-${String(closingStart.getMonth() + 1).padStart(2, '0')}-01`;

    const { rows } = await pool.query(`
      WITH opened AS (
        SELECT sales_rep, COUNT(*) as open_cnt
        FROM open_orders
        WHERE received_date >= $1 AND received_date <= $2
          AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
      ),
      closed AS (
        SELECT sales_rep, COUNT(*) as close_cnt
        FROM order_summary
        WHERE transaction_date >= $1 AND transaction_date <= $2
          AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
      )
      SELECT o.sales_rep, o.open_cnt, COALESCE(c.close_cnt, 0) as close_cnt,
        ROUND(COALESCE(c.close_cnt, 0)::numeric / NULLIF(o.open_cnt, 0) * 100, 1) as ratio
      FROM opened o
      LEFT JOIN closed c ON o.sales_rep = c.sales_rep
      WHERE o.open_cnt >= 5
        AND (COALESCE(c.close_cnt, 0)::numeric / NULLIF(o.open_cnt, 0) * 100) > 100
      ORDER BY ratio DESC
    `, [closingStartStr, monthEnd]);

    if (rows.length > 0) {
      checks.push({
        id: 'high-closing-ratio',
        severity: 'info',
        title: 'Reps with Closing Ratio Above 100%',
        description: `${rows.length} sales reps closed more orders than they opened in the 4-month window. They're clearing backlog from before the tracking window — or there may be a data gap in open orders.`,
        count: rows.length,
        details: rows,
        columns: ['sales_rep', 'open_cnt', 'close_cnt', 'ratio']
      });
    }
  } catch (e) { console.error('Check high-closing-ratio failed:', e.message); }

  // =============================================
  // MONTH-OVER-MONTH — Trend Flags
  // =============================================

  // 9. Branch revenue dropped >30% from prior month
  try {
    const { rows } = await pool.query(`
      WITH current AS (
        SELECT branch, ROUND(SUM(total_revenue)::numeric, 2) as rev
        FROM order_summary WHERE fetch_month = $1 GROUP BY branch
      ),
      prior AS (
        SELECT branch, ROUND(SUM(total_revenue)::numeric, 2) as rev
        FROM order_summary WHERE fetch_month = $2 GROUP BY branch
      )
      SELECT c.branch,
        c.rev as current_rev,
        COALESCE(p.rev, 0) as prior_rev,
        CASE WHEN COALESCE(p.rev, 0) > 0
          THEN ROUND((c.rev - p.rev) / p.rev * 100, 1)
          ELSE NULL
        END as pct_change
      FROM current c
      LEFT JOIN prior p ON c.branch = p.branch
      WHERE COALESCE(p.rev, 0) > 0
        AND ((c.rev - p.rev) / p.rev * 100) < -30
      ORDER BY pct_change ASC
    `, [yearMonth, priorYearMonth]);

    if (rows.length > 0) {
      checks.push({
        id: 'branch-revenue-drop',
        severity: 'critical',
        title: 'Branch Revenue Dropped >30%',
        description: `${rows.length} branches had a revenue decline of more than 30% compared to the prior month. This may warrant investigation.`,
        count: rows.length,
        details: rows,
        columns: ['branch', 'current_rev', 'prior_rev', 'pct_change']
      });
    }
  } catch (e) { console.error('Check branch-revenue-drop failed:', e.message); }

  // 10. Reps who went to zero orders
  try {
    const { rows } = await pool.query(`
      WITH current AS (
        SELECT sales_rep, COUNT(*) as cnt, ROUND(SUM(total_revenue)::numeric, 2) as rev
        FROM order_summary WHERE fetch_month = $1
        AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
      ),
      prior AS (
        SELECT sales_rep, COUNT(*) as cnt, ROUND(SUM(total_revenue)::numeric, 2) as rev
        FROM order_summary WHERE fetch_month = $2
        AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
      )
      SELECT p.sales_rep, p.cnt as prior_orders, p.rev as prior_rev,
        COALESCE(c.cnt, 0) as current_orders, COALESCE(c.rev, 0) as current_rev
      FROM prior p
      LEFT JOIN current c ON p.sales_rep = c.sales_rep
      WHERE COALESCE(c.cnt, 0) = 0 AND p.cnt >= 3
      ORDER BY p.rev DESC
    `, [yearMonth, priorYearMonth]);

    if (rows.length > 0) {
      checks.push({
        id: 'rep-went-zero',
        severity: 'warning',
        title: 'Reps with Zero Orders (Had Activity Prior)',
        description: `${rows.length} sales reps who closed 3+ orders last month have zero closings this month. They may have left, been reassigned, or it's still early in the month.`,
        count: rows.length,
        details: rows,
        columns: ['sales_rep', 'prior_orders', 'prior_rev', 'current_orders', 'current_rev']
      });
    }
  } catch (e) { console.error('Check rep-went-zero failed:', e.message); }

  // 11. Open orders pipeline drop >30%
  try {
    const { rows } = await pool.query(`
      WITH current AS (
        SELECT COUNT(*) as cnt FROM open_orders WHERE open_month = $1
      ),
      prior AS (
        SELECT COUNT(*) as cnt FROM open_orders WHERE open_month = $2
      )
      SELECT c.cnt as current_opens, p.cnt as prior_opens,
        CASE WHEN p.cnt > 0 THEN ROUND((c.cnt - p.cnt)::numeric / p.cnt * 100, 1) ELSE NULL END as pct_change
      FROM current c, prior p
      WHERE p.cnt > 0 AND ((c.cnt - p.cnt)::numeric / p.cnt * 100) < -30
    `, [yearMonth, priorYearMonth]);

    if (rows.length > 0) {
      checks.push({
        id: 'pipeline-drop',
        severity: 'critical',
        title: 'Order Pipeline Dropped >30%',
        description: `New orders dropped ${Math.abs(rows[0].pct_change)}% compared to prior month (${rows[0].current_opens} vs ${rows[0].prior_opens}). This could signal a market slowdown or data import issue.`,
        count: 1,
        details: rows,
        columns: ['current_opens', 'prior_opens', 'pct_change']
      });
    }
  } catch (e) { console.error('Check pipeline-drop failed:', e.message); }

  // 12. Duplicate file numbers in same month
  try {
    const { rows } = await pool.query(`
      SELECT file_number, COUNT(*) as occurrences, 
        ROUND(SUM(total_revenue)::numeric, 2) as total_rev
      FROM order_summary
      WHERE fetch_month = $1
      GROUP BY file_number
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `, [yearMonth]);

    if (rows.length > 0) {
      checks.push({
        id: 'duplicate-orders',
        severity: 'critical',
        title: 'Duplicate File Numbers',
        description: `${rows.length} file numbers appear more than once in the same month. This inflates revenue and order counts.`,
        count: rows.length,
        details: rows.slice(0, 20),
        columns: ['file_number', 'occurrences', 'total_rev']
      });
    }
  } catch (e) { console.error('Check duplicate-orders failed:', e.message); }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  checks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Summary
  const summary = {
    total_checks: 12,
    issues_found: checks.length,
    critical: checks.filter(c => c.severity === 'critical').length,
    warnings: checks.filter(c => c.severity === 'warning').length,
    info: checks.filter(c => c.severity === 'info').length,
    clean: checks.length === 0
  };

  return { summary, checks, month: yearMonth, priorMonth: priorYearMonth };
}

module.exports = { runDiscrepancyChecks };
