const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const pool = require('./database/pool');
const { fetchAndStore, fetchOpenOrders, importOpenOrders } = require('./lib/softpro-client');
const reports = require('./lib/reports');
const { buildDailyReportHtml, sendDailyReport } = require('./lib/daily-email');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// IMPORT LOGGING HELPER
// ============================================
async function logImport(importType, month, triggeredBy, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    await pool.query(`
      INSERT INTO import_log (import_type, month, records_imported, records_deleted, success, duration_ms, triggered_by)
      VALUES ($1, $2, $3, $4, true, $5, $6)
    `, [importType, month, result.inserted || result.unique_orders || 0, result.deleted || 0, duration, triggeredBy]);
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    await pool.query(`
      INSERT INTO import_log (import_type, month, success, error_message, duration_ms, triggered_by)
      VALUES ($1, $2, false, $3, $4, $5)
    `, [importType, month, err.message, duration, triggeredBy]).catch(() => {});
    throw err;
  }
}

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// ============================================
// DATA FETCH ENDPOINTS
// ============================================

// Fetch a single month from SoftPro API and store in DB
// POST /api/fetch/:yearMonth  (e.g., /api/fetch/2026-02)
app.post('/api/fetch/:yearMonth', async (req, res) => {
  const { yearMonth } = req.params;
  
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return res.status(400).json({ error: 'Invalid format. Use YYYY-MM' });
  }
  
  try {
    const meta = await logImport('revenue', yearMonth, 'manual', () => fetchAndStore(yearMonth));
    res.json({ success: true, ...meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get fetch history
app.get('/api/fetch-log', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM fetch_log ORDER BY fetched_at DESC LIMIT 50'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get available months (that have been fetched)
app.get('/api/months', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT fetch_month, COUNT(*) as order_count, SUM(total_revenue) as total_revenue
      FROM order_summary
      GROUP BY fetch_month
      ORDER BY fetch_month DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// REPORT ENDPOINTS
// ============================================

// Report 1: Daily Revenue
app.get('/api/reports/daily-revenue', async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await reports.dailyRevenue(month, year);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trends Dashboard: month-over-month revenue + open/closed order counts
app.get('/api/reports/trends', async (req, res) => {
  try {
    const product = req.query.product || 'all';
    const breakdown = req.query.breakdown || 'none';
    const data = await reports.trends({ product, breakdown });
    res.json(data);
  } catch (err) {
    console.error('Trends error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Report 2: R-14 Branches
app.get('/api/reports/r14-branches', async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await reports.r14Branches(month, year);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Report 3: R-14 Ranking
app.get('/api/reports/r14-ranking', async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await reports.r14Ranking(month, year);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Report 4: Title Officer Production
app.get('/api/reports/title-officer', async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await reports.titleOfficerProduction(month, year);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Report 5: Escrow Production
app.get('/api/reports/escrow-production', async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await reports.escrowProduction(month, year);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Report 5b: Escrow Officer Production (same data as 5, grouped by escrow_officer)
app.get('/api/reports/escrow-officer-production', async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await reports.escrowOfficerProduction(month, year);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Report 6: TSG Production
app.get('/api/reports/tsg-production', async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await reports.tsgProduction(month, year);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// OPENINGS SUB-TABS (pipeline — orders received, not closed)
// Additive endpoints; do not affect existing closings reports.
// ============================================
const openingsRoutes = [
  ['/api/reports/daily-revenue/openings', 'dailyRevenueOpenings'],
  ['/api/reports/title-officer/openings', 'titleOfficerOpenings'],
  ['/api/reports/escrow-production/openings', 'escrowProductionOpenings'],
  ['/api/reports/escrow-officer-production/openings', 'escrowOfficerOpenings'],
  ['/api/reports/tsg-production/openings', 'tsgProductionOpenings'],
  ['/api/reports/r14-branches/openings', 'r14BranchesOpenings'],
  ['/api/reports/r14-ranking/openings', 'r14RankingOpenings'],
];
for (const [route, fn] of openingsRoutes) {
  app.get(route, async (req, res) => {
    try {
      const month = parseInt(req.query.month) || new Date().getMonth() + 1;
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const data = await reports[fn](month, year);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ============================================
// RECONCILIATION ENDPOINT
// ============================================
app.get('/api/reports/reconciliation', async (req, res) => {
  const { month, year } = req.query;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  
  try {
    const { rows: dailyRevRows } = await pool.query(`
      SELECT 
        ROUND(SUM(COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0))::numeric, 2) as title_officer_total,
        ROUND(SUM(COALESCE(escrow_revenue, 0))::numeric, 2) as escrow_total,
        ROUND(SUM(COALESCE(tsg_revenue, 0))::numeric, 2) as tsg_total,
        ROUND(SUM(COALESCE(total_revenue, 0))::numeric, 2) as grand_total,
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE (COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0)) > 0) as title_officer_orders,
        COUNT(*) FILTER (WHERE COALESCE(escrow_revenue, 0) > 0) as escrow_orders,
        COUNT(*) FILTER (WHERE COALESCE(tsg_revenue, 0) > 0) as tsg_orders
      FROM order_summary
      WHERE fetch_month = $1
    `, [yearMonth]);
    
    const { rows: rankingRows } = await pool.query(`
      SELECT ROUND(SUM(total_revenue)::numeric, 2) as ranking_total
      FROM order_summary
      WHERE fetch_month = $1
        AND sales_rep IS NOT NULL AND sales_rep != ''
    `, [yearMonth]);
    
    const { rows: breakdownRows } = await pool.query(`
      SELECT 
        ROUND(SUM(title_revenue)::numeric, 2) as title_rev,
        ROUND(SUM(escrow_revenue)::numeric, 2) as escrow_rev,
        ROUND(SUM(tsg_revenue)::numeric, 2) as tsg_rev,
        ROUND(SUM(underwriter_revenue)::numeric, 2) as uw_rev,
        ROUND(SUM(total_revenue)::numeric, 2) as total_rev
      FROM order_summary
      WHERE fetch_month = $1
    `, [yearMonth]);
    
    const titleOfficer = parseFloat(dailyRevRows[0].title_officer_total) || 0;
    const escrow = parseFloat(dailyRevRows[0].escrow_total) || 0;
    const tsg = parseFloat(dailyRevRows[0].tsg_total) || 0;
    const grand = parseFloat(dailyRevRows[0].grand_total) || 0;
    const ranking = parseFloat(rankingRows[0].ranking_total) || 0;
    
    const unassignedRevenue = grand - ranking;
    
    const sumParts = titleOfficer + escrow + tsg;
    const reconciled = Math.abs(sumParts - grand) < 0.01;
    const rankingMatch = Math.abs(ranking - grand) < 1.00;
    
    res.json({
      titleOfficerTotal: titleOfficer,
      escrowTotal: escrow,
      tsgTotal: tsg,
      dailyRevenueTotal: titleOfficer,
      grandTotal: grand,
      rankingTotal: ranking,
      unassignedRevenue: unassignedRevenue,
      titleOrders: parseInt(dailyRevRows[0].title_officer_orders),
      escrowOrders: parseInt(dailyRevRows[0].escrow_orders),
      tsgOrders: parseInt(dailyRevRows[0].tsg_orders),
      totalOrders: parseInt(dailyRevRows[0].total_orders),
      breakdown: breakdownRows[0],
      reconciled: reconciled,
      rankingMatch: rankingMatch,
      checks: {
        titleEscrowTsg: reconciled ? '✓' : '✗',
        rankingMatchesTotal: rankingMatch ? '✓' : '✗',
        formula: `Title Officer ($${titleOfficer.toLocaleString()}) + Escrow ($${escrow.toLocaleString()}) + TSG ($${tsg.toLocaleString()}) = $${sumParts.toLocaleString()} vs Grand Total $${grand.toLocaleString()}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// OPEN ORDERS IMPORT ENDPOINTS (SoftPro getOpeningData API)
// ============================================
// API confirmed working Feb 2026 — returns 1 record per unique order.
// Returns all orders with a ReceivedDate in the given month.

// Import open orders for a specific month
// POST /api/import/open-orders  body: { date: "YYYY-MM-DD" }
app.post('/api/import/open-orders', async (req, res) => {
  const { date } = req.body; // e.g. "2026-02-01"
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required in YYYY-MM-DD format (first of month)' });
  }

  try {
    const yearMonth = date.substring(0, 7);
    const result = await logImport('open_orders', yearMonth, 'manual', () =>
      fetchOpenOrders(date).then(records => importOpenOrders(records, yearMonth))
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Open orders import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Import current month open orders (for daily cron / quick button)
app.post('/api/import/open-orders-today', async (req, res) => {
  try {
    const today = new Date();
    const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const yearMonth = firstOfMonth.substring(0, 7);

    const result = await logImport('open_orders', yearMonth, 'manual', () =>
      fetchOpenOrders(firstOfMonth).then(records => importOpenOrders(records, yearMonth))
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Open orders today import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get open orders summary (counts by month)
app.get('/api/open-orders/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT open_month, COUNT(*) as order_count, 
             COUNT(DISTINCT branch) as branch_count
      FROM open_orders
      GROUP BY open_month
      ORDER BY open_month DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get import log (both revenue and open orders)
app.get('/api/import/log', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM import_log ORDER BY started_at DESC LIMIT 50'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DAILY EMAIL REPORT
// ============================================

// Preview in browser — renders HTML without sending
// GET /api/email/daily-report/preview?date=YYYY-MM-DD (optional date override)
app.get('/api/email/daily-report/preview', async (req, res) => {
  try {
    const { html } = await buildDailyReportHtml(req.query.date || null);
    res.send(html);
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).send(`<pre style="color:red">${err.message}\n\n${err.stack}</pre>`);
  }
});

// Send report now (manual trigger / test)
// POST /api/email/daily-report  body: { date: 'YYYY-MM-DD' } (optional)
app.post('/api/email/daily-report', async (req, res) => {
  try {
    const result = await sendDailyReport(req.body?.date || null);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Send email error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DATA EXPLORER (for debugging/validation)
// ============================================

// Get raw line items for an order
app.get('/api/orders/:fileNumber', async (req, res) => {
  try {
    const { rows: lineItems } = await pool.query(
      'SELECT * FROM revenue_line_items WHERE file_number = $1 ORDER BY fetch_month, bill_code',
      [req.params.fileNumber]
    );
    const { rows: summary } = await pool.query(
      'SELECT * FROM order_summary WHERE file_number = $1 ORDER BY fetch_month',
      [req.params.fileNumber]
    );
    res.json({ lineItems, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get summary stats for a month
app.get('/api/stats/:yearMonth', async (req, res) => {
  try {
    const { yearMonth } = req.params;
    
    const { rows: branchStats } = await pool.query(`
      SELECT branch, category, COUNT(*) as count, SUM(total_revenue) as revenue
      FROM order_summary WHERE fetch_month = $1
      GROUP BY branch, category ORDER BY branch, category
    `, [yearMonth]);
    
    const { rows: billCodeStats } = await pool.query(`
      SELECT bill_code, COUNT(*) as count, SUM(sum_amount) as total
      FROM revenue_line_items WHERE fetch_month = $1
      GROUP BY bill_code ORDER BY bill_code
    `, [yearMonth]);
    
    const { rows: repStats } = await pool.query(`
      SELECT sales_rep, COUNT(*) as count, SUM(total_revenue) as revenue
      FROM order_summary WHERE fetch_month = $1 AND transaction_date IS NOT NULL
      GROUP BY sales_rep ORDER BY revenue DESC
    `, [yearMonth]);
    
    res.json({ branchStats, billCodeStats, repStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// LIVE DATA EXPLORER
// ============================================
const ALLOWED_SORT_COLS = ['file_number','branch','category','sales_rep','title_officer','escrow_officer','transaction_date','received_date','title_revenue','escrow_revenue','tsg_revenue','underwriter_revenue','total_revenue'];

const FILE_BRANCH_CASE = `CASE
  WHEN os.file_number LIKE '%-GLT' THEN 'Glendale'
  WHEN os.file_number LIKE '%-OCT' THEN 'Orange'
  WHEN os.file_number LIKE '%-ONT' THEN 'Inland Empire'
  WHEN os.file_number LIKE '%-PRV' THEN 'Porterville'
  WHEN os.file_number LIKE '%-TSG' OR os.file_number LIKE '99%' THEN 'TSG'
  ELSE 'Unassigned' END`;

function buildExplorerWhere(query) {
  const conditions = ['os.fetch_month = $1'];
  const params = [query.month];
  let idx = 2;

  if (query.branch) {
    conditions.push(`$${idx} = ${FILE_BRANCH_CASE}`);
    params.push(query.branch);
    idx++;
  }
  if (query.category) {
    conditions.push(`os.category = $${idx}`);
    params.push(query.category);
    idx++;
  }
  if (query.salesRep) {
    conditions.push(`os.sales_rep = $${idx}`);
    params.push(query.salesRep);
    idx++;
  }
  if (query.titleOfficer) {
    conditions.push(`os.title_officer = $${idx}`);
    params.push(query.titleOfficer);
    idx++;
  }
  if (query.search) {
    conditions.push(`os.file_number ILIKE $${idx}`);
    params.push(`%${query.search}%`);
    idx++;
  }
  return { where: conditions.join(' AND '), params, nextIdx: idx };
}

app.get('/api/data/orders', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month param required (YYYY-MM)' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const sortCol = ALLOWED_SORT_COLS.includes(req.query.sort) ? req.query.sort : 'transaction_date';
    const sortDir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

    const { where, params, nextIdx } = buildExplorerWhere(req.query);

    const [dataResult, countResult, filterResult] = await Promise.all([
      pool.query(
        `SELECT os.file_number, os.category, os.order_type, os.trans_type,
                os.sales_rep, os.title_officer, os.escrow_officer,
                ROUND(os.title_revenue::numeric, 2) as title_revenue,
                ROUND(os.escrow_revenue::numeric, 2) as escrow_revenue,
                ROUND(os.tsg_revenue::numeric, 2) as tsg_revenue,
                ROUND(os.underwriter_revenue::numeric, 2) as underwriter_revenue,
                ROUND(os.total_revenue::numeric, 2) as total_revenue,
                os.transaction_date, os.received_date,
                ${FILE_BRANCH_CASE} as branch
         FROM order_summary os
         WHERE ${where}
         ORDER BY ${sortCol === 'branch' ? `(${FILE_BRANCH_CASE})` : `os.${sortCol}`} ${sortDir} NULLS LAST, os.file_number ASC
         LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) as total,
                ROUND(COALESCE(SUM(os.total_revenue),0)::numeric, 2) as total_revenue,
                ROUND(COALESCE(SUM(os.title_revenue),0)::numeric, 2) as title_revenue,
                ROUND(COALESCE(SUM(os.escrow_revenue),0)::numeric, 2) as escrow_revenue,
                ROUND(COALESCE(SUM(os.tsg_revenue),0)::numeric, 2) as tsg_revenue,
                ROUND(COALESCE(SUM(os.underwriter_revenue),0)::numeric, 2) as uw_revenue
         FROM order_summary os WHERE ${where}`,
        params
      ),
      pool.query(
        `SELECT
           array_agg(DISTINCT (${FILE_BRANCH_CASE})) as branches,
           array_agg(DISTINCT os.category ORDER BY os.category) FILTER (WHERE os.category IS NOT NULL) as categories,
           array_agg(DISTINCT os.sales_rep ORDER BY os.sales_rep) FILTER (WHERE os.sales_rep IS NOT NULL AND os.sales_rep != '') as sales_reps,
           array_agg(DISTINCT os.title_officer ORDER BY os.title_officer) FILTER (WHERE os.title_officer IS NOT NULL AND os.title_officer != '') as title_officers
         FROM order_summary os WHERE os.fetch_month = $1`,
        [month]
      )
    ]);

    res.json({
      rows: dataResult.rows,
      total: parseInt(countResult.rows[0].total),
      summary: {
        total_revenue: parseFloat(countResult.rows[0].total_revenue) || 0,
        title_revenue: parseFloat(countResult.rows[0].title_revenue) || 0,
        escrow_revenue: parseFloat(countResult.rows[0].escrow_revenue) || 0,
        tsg_revenue: parseFloat(countResult.rows[0].tsg_revenue) || 0,
        uw_revenue: parseFloat(countResult.rows[0].uw_revenue) || 0
      },
      page,
      limit,
      filters: {
        branches: (filterResult.rows[0].branches || []).filter(Boolean).sort(),
        categories: filterResult.rows[0].categories || [],
        salesReps: filterResult.rows[0].sales_reps || [],
        titleOfficers: filterResult.rows[0].title_officers || []
      }
    });
  } catch (err) {
    console.error('Data explorer error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/data/orders/export', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month param required (YYYY-MM)' });
    }

    const { where, params } = buildExplorerWhere(req.query);

    const { rows } = await pool.query(`
      SELECT os.file_number, os.transaction_date, ${FILE_BRANCH_CASE} as branch,
             os.category, os.order_type, os.trans_type,
             os.sales_rep, os.title_officer, os.escrow_officer,
             ROUND(os.title_revenue::numeric, 2) as title_revenue,
             ROUND(os.escrow_revenue::numeric, 2) as escrow_revenue,
             ROUND(os.tsg_revenue::numeric, 2) as tsg_revenue,
             ROUND(os.underwriter_revenue::numeric, 2) as underwriter_revenue,
             ROUND(os.total_revenue::numeric, 2) as total_revenue
      FROM order_summary os
      WHERE ${where}
      ORDER BY os.transaction_date DESC
    `, params);

    const headers = ['File Number','Date','Branch','Category','Order Type','Trans Type',
      'Sales Rep','Title Officer','Escrow Officer','Title Rev','Escrow Rev',
      'TSG Rev','UW Rev','Total Rev'];
    const csvRows = rows.map(r => [
      r.file_number, r.transaction_date, r.branch, r.category, r.order_type, r.trans_type,
      r.sales_rep, r.title_officer, r.escrow_officer, r.title_revenue, r.escrow_revenue,
      r.tsg_revenue, r.underwriter_revenue, r.total_revenue
    ].map(v => `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...csvRows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=orders-${month}.csv`);
    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// BILL CODE MANAGER
// ============================================
app.get('/api/admin/bill-codes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM bill_code_classifications ORDER BY classification, bill_code'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/bill-codes/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT classification, COUNT(*) as code_count,
             ROUND(COALESCE(SUM(avg_monthly_amount),0)::numeric, 2) as monthly_total
      FROM bill_code_classifications
      GROUP BY classification ORDER BY monthly_total DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/bill-codes/:billCode', async (req, res) => {
  try {
    const { billCode } = req.params;
    const { classification, revenue_bucket } = req.body;

    const validClassifications = ['revenue', 'fee_income', 'pass_through', 'excluded', 'unclassified'];
    if (!validClassifications.includes(classification)) {
      return res.status(400).json({ error: 'Invalid classification' });
    }
    const validBuckets = ['title', 'escrow', 'tsg', 'underwriter', 'fee', null];
    if (revenue_bucket !== undefined && !validBuckets.includes(revenue_bucket)) {
      return res.status(400).json({ error: 'Invalid revenue bucket' });
    }

    const { rows } = await pool.query(`
      UPDATE bill_code_classifications
      SET classification = $1, revenue_bucket = $2, updated_at = NOW()
      WHERE bill_code = $3
      RETURNING *
    `, [classification, revenue_bucket || null, billCode]);

    if (rows.length === 0) return res.status(404).json({ error: 'Bill code not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// TRANSACTION DESK API
// ============================================
function getCurrentYearMonth() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPriorMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function getMonthsAgo(yearMonth, n) {
  let [y, m] = yearMonth.split('-').map(Number);
  for (let i = 0; i < n; i++) { m--; if (m === 0) { m = 12; y--; } }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function getYesterdayPacific() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function authenticateTD(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!apiKey || apiKey !== process.env.TD_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
  }
  next();
}

const tdLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests — try again in 15 minutes' }
});

app.use('/api/td', tdLimiter, authenticateTD);

app.get('/api/td/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'PCT Management Reports' });
});

app.get('/api/td/rep/:repName', async (req, res) => {
  try {
    const repName = decodeURIComponent(req.params.repName);
    const month = req.query.month || getCurrentYearMonth();
    const priorMonth = getPriorMonth(month);
    const yesterday = getYesterdayPacific();

    const [mtdResult, ydayResult, openResult, openTypeResult, ydayOpenResult, priorResult, ratioResult, workDayResult, rankResult, totalRepsResult] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as mtd_closed,
               ROUND(COALESCE(SUM(total_revenue),0)::numeric, 2) as mtd_revenue,
               COUNT(*) FILTER (WHERE category = 'Purchase') as mtd_purchase,
               COUNT(*) FILTER (WHERE category = 'Refinance') as mtd_refi,
               COUNT(*) FILTER (WHERE category = 'Escrow') as mtd_escrow,
               COUNT(*) FILTER (WHERE category = 'TSG') as mtd_tsg,
               ROUND(COALESCE(SUM(CASE WHEN category = 'Purchase' THEN total_revenue ELSE 0 END),0)::numeric, 2) as mtd_purchase_rev,
               ROUND(COALESCE(SUM(CASE WHEN category = 'Refinance' THEN total_revenue ELSE 0 END),0)::numeric, 2) as mtd_refi_rev,
               ROUND(COALESCE(SUM(CASE WHEN category = 'Escrow' THEN total_revenue ELSE 0 END),0)::numeric, 2) as mtd_escrow_rev,
               ROUND(COALESCE(SUM(CASE WHEN category = 'TSG' THEN total_revenue ELSE 0 END),0)::numeric, 2) as mtd_tsg_rev,
               ROUND(COALESCE(SUM(title_revenue + underwriter_revenue),0)::numeric, 2) as mtd_title_stream,
               ROUND(COALESCE(SUM(tsg_revenue),0)::numeric, 2) as mtd_tsg_stream,
               ROUND(COALESCE(SUM(CASE WHEN escrow_revenue > 0 THEN commissionable_escrow ELSE 0 END),0)::numeric, 2) as mtd_comm_escrow,
               ROUND(COALESCE(SUM(CASE WHEN LOWER(trans_type) = 'purchase' THEN title_revenue + underwriter_revenue + commissionable_escrow + tsg_revenue ELSE 0 END),0)::numeric, 2) as mtd_prod_purchase,
               ROUND(COALESCE(SUM(CASE WHEN LOWER(trans_type) = 'refinance' THEN title_revenue + underwriter_revenue + commissionable_escrow + tsg_revenue ELSE 0 END),0)::numeric, 2) as mtd_prod_refi,
               ROUND(COALESCE(SUM(CASE WHEN LOWER(trans_type) NOT IN ('purchase','refinance') OR trans_type IS NULL THEN title_revenue + underwriter_revenue + commissionable_escrow + tsg_revenue ELSE 0 END),0)::numeric, 2) as mtd_prod_other
        FROM order_summary WHERE sales_rep = $1 AND fetch_month = $2
      `, [repName, month]),
      pool.query(`
        SELECT COUNT(*) as yesterday_closed,
               ROUND(COALESCE(SUM(total_revenue),0)::numeric, 2) as yesterday_revenue
        FROM order_summary WHERE sales_rep = $1 AND transaction_date = $2
      `, [repName, yesterday]),
      pool.query(`
        SELECT COUNT(*) as mtd_opens FROM open_orders WHERE sales_rep = $1 AND open_month = $2
      `, [repName, month]),
      pool.query(`
        SELECT
          CASE
            WHEN category = 'Purchase' THEN 'purchase'
            WHEN category = 'Refinance' THEN 'refinance'
            WHEN category = 'Escrow' THEN 'escrow'
            WHEN category = 'TSG' THEN 'tsg'
            ELSE 'other'
          END as type,
          COUNT(*)::int as count
        FROM open_orders
        WHERE sales_rep = $1 AND open_month = $2
        GROUP BY type
      `, [repName, month]),
      pool.query(`
        SELECT COUNT(*) as yesterday_opens FROM open_orders WHERE sales_rep = $1 AND received_date = $2
      `, [repName, yesterday]),
      pool.query(`
        SELECT COUNT(*) as prior_closed, ROUND(COALESCE(SUM(total_revenue),0)::numeric, 2) as prior_revenue
        FROM order_summary WHERE sales_rep = $1 AND fetch_month = $2
      `, [repName, priorMonth]),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM open_orders WHERE sales_rep = $1 AND open_month >= $2 AND open_month <= $3) as created_4m,
          (SELECT COUNT(*) FROM order_summary WHERE sales_rep = $1 AND fetch_month >= $2 AND fetch_month <= $3) as closed_4m
      `, [repName, getMonthsAgo(month, 4), month]),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE d <= $2::date) as worked, COUNT(*) as total
        FROM generate_series($1::date, (date_trunc('month', $1::date) + interval '1 month - 1 day')::date, '1 day') d
        WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
      `, [`${month}-01`, yesterday]),
      pool.query(`
        SELECT COUNT(*) + 1 as rank FROM (
          SELECT sales_rep, SUM(total_revenue) as rev FROM order_summary
          WHERE fetch_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
          GROUP BY sales_rep
          HAVING SUM(total_revenue) > (SELECT COALESCE(SUM(total_revenue), 0) FROM order_summary WHERE sales_rep = $2 AND fetch_month = $1)
        ) ranked
      `, [month, repName]),
      pool.query(`
        SELECT COUNT(DISTINCT sales_rep) as total FROM order_summary
        WHERE fetch_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
      `, [month])
    ]);

    const mtd = mtdResult.rows[0];
    const yday = ydayResult.rows[0];
    const ratio = ratioResult.rows[0];
    const wd = workDayResult.rows[0];
    const mtdRev = parseFloat(mtd.mtd_revenue) || 0;
    const worked = parseInt(wd.worked);
    const totalWd = parseInt(wd.total);
    const created = parseInt(ratio.created_4m) || 0;
    const closed = parseInt(ratio.closed_4m) || 0;

    // Categorized identically to closingsByType (open_orders.category, same
    // categorizeOrder() logic as closings). 'other' kept as a true residual
    // (Unknown category — NULL order_type, etc.) so buckets sum to mtd.opens.
    const openingsByType = {
      purchase: { count: 0 },
      refinance: { count: 0 },
      escrow: { count: 0 },
      tsg: { count: 0 },
      other: { count: 0 },
    };
    openTypeResult.rows.forEach(r => {
      if (openingsByType[r.type]) openingsByType[r.type].count = parseInt(r.count) || 0;
    });

    const closingsByType = {
      purchase: { count: parseInt(mtd.mtd_purchase) || 0, revenue: parseFloat(mtd.mtd_purchase_rev) || 0 },
      refinance: { count: parseInt(mtd.mtd_refi) || 0, revenue: parseFloat(mtd.mtd_refi_rev) || 0 },
      escrow: { count: parseInt(mtd.mtd_escrow) || 0, revenue: parseFloat(mtd.mtd_escrow_rev) || 0 },
      tsg: { count: parseInt(mtd.mtd_tsg) || 0, revenue: parseFloat(mtd.mtd_tsg_rev) || 0 },
    };

    const mtdOpens = parseInt(openResult.rows[0].mtd_opens) || 0;
    const mtdClosed = parseInt(mtd.mtd_closed) || 0;
    const projectCount = (value) => (worked > 0 ? Math.round((value / worked) * totalWd) : 0);

    // Reconciliation guard: openingsByType buckets must sum to mtd.opens
    const openTypeSum = openingsByType.purchase.count + openingsByType.refinance.count
      + openingsByType.escrow.count + openingsByType.tsg.count + openingsByType.other.count;
    if (openTypeSum !== mtdOpens) {
      console.warn(`[td/rep] ${repName}: openingsByType sums to ${openTypeSum}, expected mtd.opens ${mtdOpens}`);
    }

    const repTitleRev = parseFloat(mtd.mtd_title_stream) || 0;
    const repCommEscrow = parseFloat(mtd.mtd_comm_escrow) || 0;
    const repTsgRev = parseFloat(mtd.mtd_tsg_stream) || 0;
    const repTotalProduction = Math.round((repTitleRev + repCommEscrow + repTsgRev) * 100) / 100;

    const repProductionByDealType = {
      purchase: parseFloat(mtd.mtd_prod_purchase) || 0,
      refinance: parseFloat(mtd.mtd_prod_refi) || 0,
      other: parseFloat(mtd.mtd_prod_other) || 0,
    };
    const dealTypeSum = Math.round((repProductionByDealType.purchase + repProductionByDealType.refinance + repProductionByDealType.other) * 100) / 100;
    if (Math.abs(dealTypeSum - repTotalProduction) > 0.01) {
      console.warn(`[td/rep] ${repName}: repProductionByDealType sums to ${dealTypeSum}, expected repTotalProduction ${repTotalProduction}`);
    }

    res.json({
      rep: repName,
      month,
      yesterday: {
        date: yesterday,
        closed: parseInt(yday.yesterday_closed) || 0,
        revenue: parseFloat(yday.yesterday_revenue) || 0,
        opens: parseInt(ydayOpenResult.rows[0].yesterday_opens) || 0
      },
      mtd: {
        closed: mtdClosed,
        revenue: mtdRev,
        opens: mtdOpens,
        purchase: { count: parseInt(mtd.mtd_purchase), revenue: parseFloat(mtd.mtd_purchase_rev) },
        refinance: { count: parseInt(mtd.mtd_refi), revenue: parseFloat(mtd.mtd_refi_rev) },
        escrow: { count: parseInt(mtd.mtd_escrow), revenue: parseFloat(mtd.mtd_escrow_rev) },
        tsg: { count: parseInt(mtd.mtd_tsg), revenue: parseFloat(mtd.mtd_tsg_rev) },
        openingsByType,
        closingsByType,
        projectedOpens: projectCount(mtdOpens),
        projectedClosings: projectCount(mtdClosed),
        titleRevenue: repTitleRev,
        commissionableEscrow: repCommEscrow,
        tsgRevenue: repTsgRev,
        repTotalProduction,
        repProductionByDealType,
      },
      prior: {
        month: priorMonth,
        closed: parseInt(priorResult.rows[0].prior_closed) || 0,
        revenue: parseFloat(priorResult.rows[0].prior_revenue) || 0
      },
      projected: worked > 0 ? parseFloat(((mtdRev / worked) * totalWd).toFixed(2)) : 0,
      closingRatio: {
        created,
        closed,
        ratio: created > 0 ? parseFloat(((closed / created) * 100).toFixed(1)) : null,
        window: `${getMonthsAgo(month, 4)} to ${month}`
      },
      ranking: {
        position: parseInt(rankResult.rows[0].rank),
        totalReps: parseInt(totalRepsResult.rows[0].total)
      },
      workingDays: { worked, total: totalWd, remaining: totalWd - worked }
    });
  } catch (err) {
    console.error('TD rep API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/td/leaderboard', async (req, res) => {
  try {
    const month = req.query.month || getCurrentYearMonth();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const priorMonth = getPriorMonth(month);

    const [mainResult, openResult, priorResult] = await Promise.all([
      pool.query(`
        SELECT os.sales_rep, COUNT(*) as mtd_closed,
               ROUND(SUM(os.total_revenue)::numeric, 2) as mtd_revenue,
               COUNT(*) FILTER (WHERE os.category = 'Purchase') as purchase_cnt,
               COUNT(*) FILTER (WHERE os.category = 'Refinance') as refi_cnt,
               COUNT(*) FILTER (WHERE os.category = 'Escrow') as escrow_cnt,
               COUNT(*) FILTER (WHERE os.category = 'TSG') as tsg_cnt
        FROM order_summary os
        WHERE os.fetch_month = $1 AND os.sales_rep IS NOT NULL AND os.sales_rep != ''
        GROUP BY os.sales_rep ORDER BY mtd_revenue DESC LIMIT $2
      `, [month, limit]),
      pool.query(`
        SELECT sales_rep, COUNT(*) as mtd_opens FROM open_orders
        WHERE open_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
      `, [month]),
      pool.query(`
        SELECT sales_rep, ROUND(SUM(total_revenue)::numeric, 2) as prior_revenue
        FROM order_summary
        WHERE fetch_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
        GROUP BY sales_rep
      `, [priorMonth])
    ]);

    const opensMap = {};
    openResult.rows.forEach(r => { opensMap[r.sales_rep] = parseInt(r.mtd_opens); });
    const priorMap = {};
    priorResult.rows.forEach(r => { priorMap[r.sales_rep] = parseFloat(r.prior_revenue); });

    const leaderboard = mainResult.rows.map((r, i) => ({
      rank: i + 1,
      salesRep: r.sales_rep,
      mtdClosed: parseInt(r.mtd_closed),
      mtdRevenue: parseFloat(r.mtd_revenue),
      mtdOpens: opensMap[r.sales_rep] || 0,
      priorRevenue: priorMap[r.sales_rep] || 0,
      purchaseCount: parseInt(r.purchase_cnt),
      refiCount: parseInt(r.refi_cnt),
      escrowCount: parseInt(r.escrow_cnt),
      tsgCount: parseInt(r.tsg_cnt)
    }));

    res.json({ month, priorMonth, totalReps: mainResult.rows.length, leaderboard });
  } catch (err) {
    console.error('TD leaderboard API error:', err);
    res.status(500).json({ error: err.message });
  }
});

const TD_MONTH_NAMES = ['','January','February','March','April','May','June',
  'July','August','September','October','November','December'];

app.get('/api/td/trends', async (req, res) => {
  try {
    const repName = req.query.repName;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const currentYear = now.getFullYear();
    const priorYear = currentYear - 1;

    async function getYearData(year) {
      let cq = `SELECT EXTRACT(MONTH FROM transaction_date)::int as month, COUNT(*) as closings,
                        ROUND(SUM(total_revenue)::numeric, 2) as revenue
                 FROM order_summary WHERE EXTRACT(YEAR FROM transaction_date) = $1`;
      let cp = [year];
      let oq = `SELECT EXTRACT(MONTH FROM received_date)::int as month, COUNT(*) as openings
                 FROM open_orders WHERE EXTRACT(YEAR FROM received_date) = $1`;
      let op = [year];

      if (repName) {
        cq += ` AND sales_rep = $2`; cp.push(repName);
        oq += ` AND sales_rep = $2`; op.push(repName);
      }
      cq += ` GROUP BY month ORDER BY month`;
      oq += ` GROUP BY month ORDER BY month`;

      const [{ rows: cRows }, { rows: oRows }] = await Promise.all([
        pool.query(cq, cp), pool.query(oq, op)
      ]);

      const openMap = {}; oRows.forEach(r => { openMap[r.month] = parseInt(r.openings); });
      const closeMap = {}; cRows.forEach(r => { closeMap[r.month] = { closings: parseInt(r.closings), revenue: parseFloat(r.revenue) }; });
      const allM = new Set([...oRows.map(r => r.month), ...cRows.map(r => r.month)]);

      return [...allM].sort((a, b) => a - b).map(m => ({
        month: m, monthName: TD_MONTH_NAMES[m],
        openings: openMap[m] || 0,
        closings: closeMap[m]?.closings || 0,
        revenue: closeMap[m]?.revenue || 0
      }));
    }

    const [currentYearData, priorYearData] = await Promise.all([
      getYearData(currentYear), getYearData(priorYear)
    ]);

    res.json({
      currentYear: { year: currentYear, months: currentYearData },
      priorYear: { year: priorYear, months: priorYearData }
    });
  } catch (err) {
    console.error('TD trends error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/td/production-history', async (req, res) => {
  try {
    const year = parseInt(req.query.year);
    if (!year) return res.status(400).json({ error: 'year required' });
    const repName = req.query.repName;

    let cq = `SELECT EXTRACT(MONTH FROM transaction_date)::int as month, COUNT(*) as closings,
                      ROUND(SUM(total_revenue)::numeric, 2) as revenue
               FROM order_summary WHERE EXTRACT(YEAR FROM transaction_date) = $1`;
    let cp = [year];
    let oq = `SELECT EXTRACT(MONTH FROM received_date)::int as month, COUNT(*) as openings
               FROM open_orders WHERE EXTRACT(YEAR FROM received_date) = $1`;
    let op = [year];

    if (repName) {
      cq += ` AND sales_rep = $2`; cp.push(repName);
      oq += ` AND sales_rep = $2`; op.push(repName);
    }
    cq += ` GROUP BY month ORDER BY month`;
    oq += ` GROUP BY month ORDER BY month`;

    const [{ rows: cRows }, { rows: oRows }] = await Promise.all([
      pool.query(cq, cp), pool.query(oq, op)
    ]);

    const openMap = {}; oRows.forEach(r => { openMap[r.month] = parseInt(r.openings); });
    const closeMap = {}; cRows.forEach(r => { closeMap[r.month] = { closings: parseInt(r.closings), revenue: parseFloat(r.revenue) }; });
    const allM = new Set([...oRows.map(r => r.month), ...cRows.map(r => r.month)]);

    const months = [...allM].sort((a, b) => a - b).map(m => {
      const openings = openMap[m] || 0;
      const closings = closeMap[m]?.closings || 0;
      return {
        month: m, monthName: TD_MONTH_NAMES[m],
        openings, closings,
        revenue: closeMap[m]?.revenue || 0,
        closingRatio: openings > 0 ? Math.round((closings / openings) * 100) : 0
      };
    });

    res.json({ year, repName: repName || 'All Reps', months });
  } catch (err) {
    console.error('TD production-history error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/td/closings', async (req, res) => {
  try {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const year = parseInt(req.query.year) || now.getFullYear();
    const repName = req.query.repName;
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

    let query = `SELECT file_number, COALESCE(full_address, '') as full_address, transaction_date,
                        ROUND(total_revenue::numeric, 2) as revenue, category, sales_rep, title_officer
                 FROM order_summary WHERE fetch_month = $1`;
    let params = [yearMonth];

    if (repName) { query += ` AND sales_rep = $2`; params.push(repName); }
    query += ` ORDER BY transaction_date DESC`;

    const { rows } = await pool.query(query, params);

    const closings = rows.map(r => ({
      fileNumber: r.file_number,
      address: r.full_address,
      closedDate: r.transaction_date,
      revenue: parseFloat(r.revenue),
      category: r.category,
      salesRep: r.sales_rep,
      titleOfficer: r.title_officer
    }));

    res.json({
      month, year, repName: repName || 'All Reps',
      totalClosings: closings.length,
      totalRevenue: closings.reduce((sum, c) => sum + c.revenue, 0),
      closings
    });
  } catch (err) {
    console.error('TD closings error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/td/client-summary', async (req, res) => {
  try {
    const year = parseInt(req.query.year);
    if (!year) return res.status(400).json({ error: 'year required' });
    const repName = req.query.repName;

    const yearStart = `${year}-01`;
    const yearEnd = `${year}-12`;
    const priorYearStart = `${year - 1}-01`;
    const priorYearEnd = `${year - 1}-12`;

    let clientQuery = `
      SELECT
        COALESCE(NULLIF(main_contact, ''), marketing_source, 'Unknown') as client_name,
        COALESCE(NULLIF(marketing_source, ''), 'Unknown') as company_name,
        COUNT(*) as deals,
        ROUND(SUM(total_revenue)::numeric, 2) as revenue,
        MAX(transaction_date)::text as last_close_date,
        EXTRACT(MONTH FROM transaction_date)::int as close_month
      FROM order_summary
      WHERE fetch_month >= $1 AND fetch_month <= $2 AND total_revenue > 0
    `;
    let params = [yearStart, yearEnd];
    let idx = 3;
    if (repName) { clientQuery += ` AND sales_rep = $${idx}`; params.push(repName); idx++; }
    clientQuery += ` GROUP BY client_name, company_name, close_month ORDER BY revenue DESC`;

    const { rows: rawDeals } = await pool.query(clientQuery, params);

    const clientMap = {};
    for (const row of rawDeals) {
      const key = `${row.client_name}|||${row.company_name}`;
      if (!clientMap[key]) {
        clientMap[key] = {
          clientName: row.client_name, companyName: row.company_name,
          deals: 0, revenue: 0, lastCloseDate: row.last_close_date,
          monthlyDeals: [0,0,0,0,0,0,0,0,0,0,0,0]
        };
      }
      const c = clientMap[key];
      c.deals += parseInt(row.deals);
      c.revenue += parseFloat(row.revenue);
      if (row.last_close_date > c.lastCloseDate) c.lastCloseDate = row.last_close_date;
      c.monthlyDeals[parseInt(row.close_month) - 1] += parseInt(row.deals);
    }

    let firstDealQuery = `
      SELECT COALESCE(NULLIF(main_contact, ''), marketing_source, 'Unknown') as client_name,
             COALESCE(NULLIF(marketing_source, ''), 'Unknown') as company_name,
             MIN(transaction_date)::text as first_deal_date
      FROM order_summary WHERE total_revenue > 0
    `;
    let firstParams = [];
    let fi = 1;
    if (repName) { firstDealQuery += ` AND sales_rep = $${fi}`; firstParams.push(repName); fi++; }
    firstDealQuery += ` GROUP BY client_name, company_name`;
    const { rows: firstDeals } = await pool.query(firstDealQuery, firstParams);
    const firstDealMap = {};
    firstDeals.forEach(r => { firstDealMap[`${r.client_name}|||${r.company_name}`] = r.first_deal_date; });

    let priorQuery = `
      SELECT DISTINCT COALESCE(NULLIF(main_contact, ''), marketing_source, 'Unknown') as client_name,
             COALESCE(NULLIF(marketing_source, ''), 'Unknown') as company_name
      FROM order_summary WHERE fetch_month >= $1 AND fetch_month <= $2 AND total_revenue > 0
    `;
    let priorParams = [priorYearStart, priorYearEnd];
    if (repName) { priorQuery += ` AND sales_rep = $3`; priorParams.push(repName); }
    const { rows: priorClients } = await pool.query(priorQuery, priorParams);
    const priorSet = new Set(priorClients.map(r => `${r.client_name}|||${r.company_name}`));

    const clients = Object.entries(clientMap)
      .map(([key, data]) => {
        const firstDealDate = firstDealMap[key] || null;
        return {
          clientName: data.clientName, companyName: data.companyName,
          deals: data.deals, revenue: data.revenue,
          lastCloseDate: data.lastCloseDate, firstDealDate,
          isNewThisYear: firstDealDate ? firstDealDate.startsWith(String(year)) : false,
          isRepeat: priorSet.has(key),
          monthlyDeals: data.monthlyDeals
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const totalClients = clients.length;
    const totalRevenue = clients.reduce((s, c) => s + c.revenue, 0);
    const totalDeals = clients.reduce((s, c) => s + c.deals, 0);

    res.json({
      year, repName: repName || 'All Reps',
      totals: {
        totalClients,
        repeatClients: clients.filter(c => c.isRepeat).length,
        newClients: clients.filter(c => c.isNewThisYear).length,
        topClientRevenue: clients.length > 0 ? clients[0].revenue : 0,
        avgDealsPerClient: totalClients > 0 ? Math.round((totalDeals / totalClients) * 10) / 10 : 0,
        totalRevenue, totalDeals
      },
      clients
    });
  } catch (err) {
    console.error('TD client-summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DISCREPANCIES
// ============================================
const { runDiscrepancyChecks } = require('./lib/discrepancies');

app.get('/api/reports/discrepancies', async (req, res) => {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    const result = await runDiscrepancyChecks(month, year);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// TESSA (AI Q&A) ROUTES
// ============================================
const { askTessa, saveQuestion, getHistory } = require('./lib/tessa');

app.post('/api/tessa/ask', async (req, res) => {
  const { question, history } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required' });
  try {
    // Cap history at 10 turns to stay within token limits
    const trimmedHistory = Array.isArray(history) ? history.slice(-10) : [];
    const result = await askTessa(question, trimmedHistory);
    await saveQuestion(question, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tessa/history', async (req, res) => {
  try {
    const history = await getHistory(parseInt(req.query.limit) || 20);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tessa/rerun', async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'SQL is required' });
  const sqlUpper = sql.toUpperCase().trim();
  if (!sqlUpper.startsWith('SELECT') ||
      /\b(UPDATE|DELETE|INSERT|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/.test(sqlUpper)) {
    return res.status(400).json({ error: 'Only SELECT queries allowed' });
  }
  try {
    const start = Date.now();
    const result = await pool.query(sql);
    res.json({ success: true, data: result.rows, rowCount: result.rowCount, duration_ms: Date.now() - start });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tessa/save/:id', async (req, res) => {
  try {
    await pool.query('UPDATE tessa_questions SET is_saved = NOT is_saved WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// SETTINGS ROUTES
// ============================================
const { sendReportEmail, getEmailConfig, getRecipients } = require('./lib/email');

app.get('/api/settings/email', async (req, res) => {
  try {
    const config = await getEmailConfig();
    const recipients = await getRecipients();
    res.json({ config, recipients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/email', async (req, res) => {
  const { sendgrid_api_key, from_email, from_name, schedule_time, is_active } = req.body;
  try {
    await pool.query(`
      UPDATE email_settings SET
        sendgrid_api_key = COALESCE($1, sendgrid_api_key),
        from_email = COALESCE($2, from_email),
        from_name = COALESCE($3, from_name),
        schedule_time = COALESCE($4, schedule_time),
        is_active = COALESCE($5, is_active),
        updated_at = NOW()
      WHERE id = 1
    `, [sendgrid_api_key, from_email, from_name, schedule_time, is_active]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/recipients', async (req, res) => {
  const { name, email, reports } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO email_recipients (name, email, reports) VALUES ($1, $2, $3) RETURNING *',
      [name, email, JSON.stringify(reports || ['daily-revenue', 'r14-ranking'])]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/recipients/:id', async (req, res) => {
  const { name, email, reports, is_active } = req.body;
  try {
    await pool.query(
      `UPDATE email_recipients SET name = COALESCE($1, name), email = COALESCE($2, email),
       reports = COALESCE($3, reports), is_active = COALESCE($4, is_active) WHERE id = $5`,
      [name, email, reports ? JSON.stringify(reports) : null, is_active, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/settings/recipients/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM email_recipients WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/test-email', async (req, res) => {
  const { reportId, month, year } = req.body;
  try {
    const results = await sendReportEmail(
      reportId || 'daily-revenue',
      month || new Date().getMonth() + 1,
      year || new Date().getFullYear()
    );
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings/app', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM app_settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/app', async (req, res) => {
  const { key, value } = req.body;
  try {
    await pool.query(
      'INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      [key, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PER-OFFICER EMAILS (title officers — privacy-clean, each sees only their own)
// ============================================
const { buildOfficerEmailHtml, sendOfficerEmails, sendOfficerEmailsTest } = require('./lib/officer-email');

// List officer recipients (for Settings UI)
app.get('/api/email/officer-recipients', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, officer_name, email, officer_type, is_active FROM officer_email_recipients ORDER BY officer_name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a recipient's email and/or active flag
app.put('/api/email/officer-recipients/:officerName', async (req, res) => {
  try {
    const officerName = decodeURIComponent(req.params.officerName);
    const { email, is_active } = req.body;
    await pool.query(
      `UPDATE officer_email_recipients
       SET email = COALESCE($2, email), is_active = COALESCE($3, is_active)
       WHERE officer_name = $1`,
      [officerName, email ?? null, typeof is_active === 'boolean' ? is_active : null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview a single officer's email HTML (no send)
app.get('/api/email/officer-preview/:officerName', async (req, res) => {
  try {
    const { html } = await buildOfficerEmailHtml(decodeURIComponent(req.params.officerName));
    res.set('Content-Type', 'text/html').send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Send a TEST batch — every active officer's email goes to one test address
app.post('/api/email/officer-emails/test', async (req, res) => {
  try {
    const testEmail = req.body.email || 'ghernandez@pct.com';
    const results = await sendOfficerEmailsTest(testEmail);
    res.json({ success: true, sentTo: testEmail, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send LIVE to each officer (manual trigger; cron go-live is gated separately)
app.post('/api/email/officer-emails', async (req, res) => {
  try {
    const results = await sendOfficerEmails();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PER-OFFICER EMAILS (escrow officers — SCAFFOLDING, preview + test only, NOT wired into cron)
// ============================================
const { buildEscrowOfficerEmailHtml, sendEscrowOfficerEmails, sendEscrowOfficerEmailsTest } = require('./lib/escrow-officer-email');

// Preview a single escrow officer's email HTML (no send)
app.get('/api/email/escrow-officer-preview/:officerName', async (req, res) => {
  try {
    const { html } = await buildEscrowOfficerEmailHtml(decodeURIComponent(req.params.officerName));
    res.set('Content-Type', 'text/html').send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Send a TEST batch — every active escrow officer's email goes to one test address
app.post('/api/email/escrow-officer-emails/test', async (req, res) => {
  try {
    const testEmail = req.body.email || 'ghernandez@pct.com';
    const results = await sendEscrowOfficerEmailsTest(testEmail);
    res.json({ success: true, sentTo: testEmail, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ESCROW MANAGER ROLLUP (team commissionable rollup to the escrow manager)
// ============================================
const { buildEscrowManagerEmailHtml, sendEscrowManagerEmails, sendEscrowManagerEmailsTest } = require('./lib/escrow-manager-email');

// Preview the escrow manager rollup HTML (no send)
app.get('/api/email/escrow-manager-preview/:managerName', async (req, res) => {
  try {
    const { html } = await buildEscrowManagerEmailHtml(decodeURIComponent(req.params.managerName));
    res.set('Content-Type', 'text/html').send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Send a TEST batch — every active escrow manager's rollup goes to one test address
app.post('/api/email/escrow-manager-emails/test', async (req, res) => {
  try {
    const testEmail = req.body.email || 'ghernandez@pct.com';
    const results = await sendEscrowManagerEmailsTest(testEmail);
    res.json({ success: true, sentTo: testEmail, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PER-MANAGER EMAILS (sales managers — each sees only their assigned reps)
// ============================================
const { buildManagerEmailHtml, sendManagerEmails, sendManagerEmailsTest } = require('./lib/manager-email');

// Preview a manager's email HTML (no send)
app.get('/api/email/manager-preview/:managerName', async (req, res) => {
  try {
    const { html, hasData } = await buildManagerEmailHtml(decodeURIComponent(req.params.managerName));
    if (!hasData) return res.send('No reps assigned to this manager.');
    res.set('Content-Type', 'text/html').send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Send a TEST batch — every active manager's email goes to one test address
app.post('/api/email/manager-emails/test', async (req, res) => {
  try {
    const testEmail = req.body.email || 'ghernandez@pct.com';
    const results = await sendManagerEmailsTest(testEmail);
    res.json({ success: true, sentTo: testEmail, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send LIVE to each manager (manual trigger; cron go-live gated separately)
app.post('/api/email/manager-emails', async (req, res) => {
  try {
    const results = await sendManagerEmails();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Manager + assignment management (Settings UI) ---

// Managers, assignments, and reps available to assign
app.get('/api/admin/managers', async (req, res) => {
  try {
    const { rows: managers } = await pool.query('SELECT * FROM sales_managers ORDER BY manager_name');
    const { rows: assignments } = await pool.query('SELECT * FROM rep_manager_assignments ORDER BY manager_name, sales_rep');
    const { rows: unassigned } = await pool.query(`
      SELECT DISTINCT sales_rep FROM order_summary
      WHERE sales_rep IS NOT NULL AND sales_rep <> ''
        AND sales_rep NOT IN (SELECT sales_rep FROM rep_manager_assignments)
      ORDER BY sales_rep
    `);
    res.json({ managers, assignments, availableReps: unassigned.map(r => r.sales_rep) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a manager
app.post('/api/admin/managers', async (req, res) => {
  try {
    const { manager_name, email } = req.body;
    if (!manager_name || !email) return res.status(400).json({ error: 'manager_name and email required' });
    await pool.query(
      `INSERT INTO sales_managers (manager_name, email) VALUES ($1, $2)
       ON CONFLICT (manager_name) DO UPDATE SET email = $2`,
      [manager_name, email]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a manager's email and/or active flag
app.put('/api/admin/managers/:managerName', async (req, res) => {
  try {
    const managerName = decodeURIComponent(req.params.managerName);
    const { email, is_active } = req.body;
    await pool.query(
      `UPDATE sales_managers
       SET email = COALESCE($2, email), is_active = COALESCE($3, is_active)
       WHERE manager_name = $1`,
      [managerName, email ?? null, typeof is_active === 'boolean' ? is_active : null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assign a rep to a manager (1 rep = 1 manager; upsert)
app.post('/api/admin/assignments', async (req, res) => {
  try {
    const { sales_rep, manager_name } = req.body;
    if (!sales_rep || !manager_name) return res.status(400).json({ error: 'sales_rep and manager_name required' });
    await pool.query(
      `INSERT INTO rep_manager_assignments (sales_rep, manager_name) VALUES ($1, $2)
       ON CONFLICT (sales_rep) DO UPDATE SET manager_name = $2`,
      [sales_rep, manager_name]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unassign a rep
app.delete('/api/admin/assignments/:salesRep', async (req, res) => {
  try {
    await pool.query('DELETE FROM rep_manager_assignments WHERE sales_rep = $1', [decodeURIComponent(req.params.salesRep)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PER-REP DAILY EMAILS (Sales Reps)
// ============================================
const { buildRepEmailHtml, sendRepEmails, sendRepEmailsTest, sendRepEmailsSample } = require('./lib/rep-email');

// Preview a rep's email HTML (no send)
app.get('/api/email/rep-preview/:repName', async (req, res) => {
  try {
    const { html } = await buildRepEmailHtml(decodeURIComponent(req.params.repName));
    res.set('Content-Type', 'text/html').send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Send a 3-rep SAMPLE to one test address (avoids flooding the inbox with ~37 emails)
app.post('/api/email/rep-emails/test-sample', async (req, res) => {
  try {
    const testEmail = req.body.email || 'ghernandez@pct.com';
    const sampleReps = Array.isArray(req.body.reps) && req.body.reps.length ? req.body.reps : null;
    const results = await sendRepEmailsSample(testEmail, sampleReps);
    res.json({ success: true, sentTo: testEmail, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a FULL TEST batch — every active rep's email goes to one test address (~37 emails)
app.post('/api/email/rep-emails/test', async (req, res) => {
  try {
    const testEmail = req.body.email || 'ghernandez@pct.com';
    const results = await sendRepEmailsTest(testEmail);
    res.json({ success: true, sentTo: testEmail, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send LIVE to each rep (manual trigger; cron go-live gated separately)
app.post('/api/email/rep-emails', async (req, res) => {
  try {
    const results = await sendRepEmails();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rep email recipients for the Settings UI (from rep_manager_assignments)
app.get('/api/admin/rep-emails', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT sales_rep, manager_name, email, is_active FROM rep_manager_assignments ORDER BY manager_name, sales_rep'
    );
    const { rows: flag } = await pool.query("SELECT value FROM app_settings WHERE key = 'rep_emails_enabled'");
    res.json({ reps: rows, enabled: flag[0]?.value === 'true' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a rep's email and/or active flag
app.put('/api/admin/rep-emails/:salesRep', async (req, res) => {
  try {
    const salesRep = decodeURIComponent(req.params.salesRep);
    const { email, is_active } = req.body;
    await pool.query(
      `UPDATE rep_manager_assignments
       SET email = COALESCE($2, email), is_active = COALESCE($3, is_active)
       WHERE sales_rep = $1`,
      [salesRep, email ?? null, typeof is_active === 'boolean' ? is_active : null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Master toggle for rep emails (rep_emails_enabled in app_settings)
app.put('/api/admin/rep-emails-enabled', async (req, res) => {
  try {
    const enabled = req.body.enabled === true || req.body.enabled === 'true';
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('rep_emails_enabled', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [enabled ? 'true' : 'false']
    );
    res.json({ success: true, enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// NIGHTLY CRON: Automated Revenue + Open Orders Import
// ============================================
// Checks every minute. Only runs at the scheduled time if cron_enabled = true.
// Default: 9:00 PM Pacific daily (configurable via app_settings).
let cronLastRun = ''; // prevent double-runs within the same minute

cron.schedule('* * * * *', async () => {
  try {
    // Check if cron is enabled
    const { rows: enabledRows } = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'cron_enabled'"
    );
    if (enabledRows[0]?.value !== 'true') return;

    // Get scheduled time
    const { rows: timeRows } = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'cron_time'"
    );
    const scheduledTime = timeRows[0]?.value || '21:00';
    const [schedHour, schedMin] = scheduledTime.split(':').map(Number);

    // Get current Pacific time
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    if (currentHour !== schedHour || currentMin !== schedMin) return;

    // Prevent double-run within same minute
    const runKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${currentHour}-${currentMin}`;
    if (cronLastRun === runKey) return;
    cronLastRun = runKey;

    console.log('=== NIGHTLY IMPORT STARTED ===', new Date().toISOString());

    // Anchor to Pacific time (matches the emails' date logic) so the month never
    // flips a day early relative to Pacific — the root cause of the month-end drop.
    const yearMonth = getCurrentYearMonth();
    const firstOfMonth = `${yearMonth}-01`;

    // 1. Import Revenue (current month)
    try {
      const revResult = await logImport('revenue', yearMonth, 'cron', () => fetchAndStore(yearMonth));
      console.log(`Cron revenue: ${revResult.unique_orders} orders, $${revResult.total_revenue?.toFixed(2)} for ${yearMonth}`);
    } catch (err) {
      console.error('Cron revenue FAILED:', err.message);
    }

    // 2. Import Open Orders (current month)
    try {
      const openResult = await logImport('open_orders', yearMonth, 'cron', () =>
        fetchOpenOrders(firstOfMonth).then(records => importOpenOrders(records, yearMonth))
      );
      console.log(`Cron open orders: ${openResult.inserted} orders for ${yearMonth}`);
    } catch (err) {
      console.error('Cron open orders FAILED:', err.message);
    }

    // 2b. Prior-month sweep: on the first 3 days of a month, re-finalize the prior
    // month so its last business day is captured (the current-month anchor abandons
    // it on the 1st). UNCONDITIONAL — do not try to detect "missing" days; a calendar
    // gap can be a legitimate holiday lull (see Nov 2025). Idempotency (delete+reinsert
    // by fetch_month) makes a redundant re-fetch a safe no-op, so running it 3 mornings
    // running is harmless — later runs pick up any late-posting corrections.
    const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const dayOfMonth = pacificNow.getDate();
    if (dayOfMonth <= 3) {
      const priorYearMonth = getPriorMonth(yearMonth);
      try {
        console.log(`Prior-month sweep: re-finalizing ${priorYearMonth}`);
        await logImport('revenue', priorYearMonth, 'cron-sweep', () => fetchAndStore(priorYearMonth));
        console.log(`Prior-month sweep complete: ${priorYearMonth}`);
      } catch (err) {
        // Don't let a sweep failure break the current-month import
        console.error(`Prior-month sweep FAILED for ${priorYearMonth}:`, err.message);
      }

      // Guardrail (informational only — a zero-close last weekday can be a legitimate
      // holiday, e.g. the Friday after Thanksgiving; this just surfaces it for a human).
      try {
        const { rows } = await pool.query(`
          SELECT MAX(transaction_date::date) as last_close,
            (date_trunc('month', ($1||'-01')::date) + interval '1 month - 1 day')::date as month_end
          FROM order_summary WHERE fetch_month = $1
        `, [priorYearMonth]);
        const lastClose = rows[0]?.last_close;
        const monthEnd = rows[0]?.month_end;
        if (lastClose && monthEnd) {
          const gap = Math.round((new Date(monthEnd) - new Date(lastClose)) / 86400000);
          if (gap >= 1) {
            console.warn(`GUARDRAIL: ${priorYearMonth} last close ${lastClose} is ${gap} day(s) before month-end ${monthEnd}. Verify this is a holiday/weekend lull, not a missing import.`);
          }
        }
      } catch (err) {
        console.error(`Prior-month guardrail check FAILED for ${priorYearMonth}:`, err.message);
      }
    }

    // 3. Send daily email report (after data is fresh)
    try {
      const emailResult = await sendDailyReport();
      if (emailResult.sent) {
        console.log(`Cron email: sent to ${emailResult.recipients.join(', ')}`);
        await pool.query(`
          INSERT INTO import_log (import_type, month, records_imported, success, duration_ms, triggered_by)
          VALUES ('daily_email', $1, $2, true, 0, 'cron')
        `, [yearMonth, emailResult.recipients.length]).catch(() => {});
      } else {
        console.log(`Cron email: skipped — ${emailResult.reason}`);
      }
    } catch (err) {
      console.error('Cron email FAILED:', err.message);
      await pool.query(`
        INSERT INTO import_log (import_type, month, success, error_message, triggered_by)
        VALUES ('daily_email', $1, false, $2, 'cron')
      `, [yearMonth, err.message]).catch(() => {});
    }

    console.log('=== NIGHTLY IMPORT COMPLETE ===', new Date().toISOString());
  } catch (err) {
    console.error('Cron scheduler error:', err.message);
  }
});

console.log('Nightly import cron scheduled (checks every minute, runs at configured time)');

// ============================================
// OFFICER EMAILS CRON: 5:00 AM Pacific daily
// ============================================
// Separate from the 9 PM data import. By 5 AM, "yesterday's" closings have
// already been imported by the prior night's 9 PM run, so the data is complete.
// Gated by app_settings.officer_emails_enabled.
cron.schedule('0 5 * * *', async () => {
  console.log('=== 5 AM EMAILS START ===', new Date().toISOString());

  // Title officer emails — own independent block (no early return; other types unaffected)
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'officer_emails_enabled'");
  if (rows[0]?.value === 'true') {
    try {
      const results = await sendOfficerEmails();
      const sent = results.filter(r => r.sent).length;
      console.log(`Officer emails sent: ${sent}/${results.length}`);
      results.forEach(r => {
        if (!r.sent) console.error(`  FAILED: ${r.officer} — ${r.error}`);
      });
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, triggered_by)
        VALUES ('officer_emails', $1, true, 'cron')
      `, [sent]).catch(() => {});
    } catch (err) {
      console.error('Officer emails FAILED:', err.message);
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, error_message, triggered_by)
        VALUES ('officer_emails', 0, false, $1, 'cron')
      `, [err.message]).catch(() => {});
    }
  } else {
    console.log('Title officer emails disabled — skipping (other emails unaffected)');
  }

  // Rep emails — gated by app_settings.rep_emails_enabled (independent of officer flag)
  const { rows: repFlag } = await pool.query("SELECT value FROM app_settings WHERE key = 'rep_emails_enabled'");
  if (repFlag[0]?.value !== 'true') {
    console.log('Rep emails disabled — skipping');
  } else {
    try {
      const repResults = await sendRepEmails();
      const repSent = repResults.filter(r => r.sent).length;
      console.log(`Rep emails sent: ${repSent}/${repResults.length}`);
      repResults.forEach(r => {
        if (!r.sent) console.error(`  FAILED: ${r.rep} — ${r.error}`);
      });
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, triggered_by)
        VALUES ('rep_emails', $1, true, 'cron')
      `, [repSent]).catch(() => {});
    } catch (err) {
      console.error('Rep emails FAILED:', err.message);
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, error_message, triggered_by)
        VALUES ('rep_emails', 0, false, $1, 'cron')
      `, [err.message]).catch(() => {});
    }
  }

  // Manager emails — gated by app_settings.manager_emails_enabled
  const { rows: mgrEnabled } = await pool.query("SELECT value FROM app_settings WHERE key = 'manager_emails_enabled'");
  if (mgrEnabled[0]?.value !== 'true') {
    console.log('Manager emails disabled — skipping');
  } else {
    try {
      const mgrResults = await sendManagerEmails();
      const mgrSent = mgrResults.filter(r => r.sent).length;
      console.log(`Manager emails sent: ${mgrSent}/${mgrResults.length}`);
      mgrResults.forEach(r => {
        if (!r.sent) console.error(`  FAILED: ${r.manager} — ${r.error || r.reason}`);
      });
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, triggered_by)
        VALUES ('manager_emails', $1, true, 'cron')
      `, [mgrSent]).catch(() => {});
    } catch (err) {
      console.error('Manager emails FAILED:', err.message);
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, error_message, triggered_by)
        VALUES ('manager_emails', 0, false, $1, 'cron')
      `, [err.message]).catch(() => {});
    }
  }

  // Escrow officer emails — gated by app_settings.escrow_officer_emails_enabled
  const { rows: escOffEnabled } = await pool.query("SELECT value FROM app_settings WHERE key = 'escrow_officer_emails_enabled'");
  if (escOffEnabled[0]?.value !== 'true') {
    console.log('Escrow officer emails disabled — skipping');
  } else {
    try {
      const r = await sendEscrowOfficerEmails();
      const sent = r.filter(x => x.sent).length;
      console.log(`Escrow officer emails sent: ${sent}/${r.length}`);
      r.forEach(x => { if (!x.sent) console.error(`  FAILED: ${x.officer} — ${x.error || x.reason}`); });
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, triggered_by)
        VALUES ('escrow_officer_emails', $1, true, 'cron')
      `, [sent]).catch(() => {});
    } catch (err) {
      console.error('Escrow officer emails FAILED:', err.message);
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, error_message, triggered_by)
        VALUES ('escrow_officer_emails', 0, false, $1, 'cron')
      `, [err.message]).catch(() => {});
    }
  }

  // Escrow manager rollup — gated by app_settings.escrow_manager_emails_enabled
  const { rows: escMgrEnabled } = await pool.query("SELECT value FROM app_settings WHERE key = 'escrow_manager_emails_enabled'");
  if (escMgrEnabled[0]?.value !== 'true') {
    console.log('Escrow manager emails disabled — skipping');
  } else {
    try {
      const r = await sendEscrowManagerEmails();
      const sent = r.filter(x => x.sent).length;
      console.log(`Escrow manager emails sent: ${sent}/${r.length}`);
      r.forEach(x => { if (!x.sent) console.error(`  FAILED: ${x.manager} — ${x.error || x.reason}`); });
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, triggered_by)
        VALUES ('escrow_manager_emails', $1, true, 'cron')
      `, [sent]).catch(() => {});
    } catch (err) {
      console.error('Escrow manager emails FAILED:', err.message);
      await pool.query(`
        INSERT INTO import_log (import_type, records_imported, success, error_message, triggered_by)
        VALUES ('escrow_manager_emails', 0, false, $1, 'cron')
      `, [err.message]).catch(() => {});
    }
  }

  console.log('=== 5 AM EMAILS COMPLETE ===', new Date().toISOString());
}, {
  timezone: 'America/Los_Angeles'
});

console.log('Officer + rep + manager + escrow officer + escrow manager emails scheduled: 5:00 AM Pacific daily');

// ============================================
// START SERVER
// ============================================
// Only listen when running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Manager Reports API running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

// Export for Vercel serverless
module.exports = app;
