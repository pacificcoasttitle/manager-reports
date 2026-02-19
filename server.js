const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./database/pool');
const { fetchAndStore, fetchOpenOrders, importOpenOrders } = require('./lib/softpro-client');
const reports = require('./lib/reports');

const app = express();
const PORT = process.env.PORT || 3001;

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
    const meta = await fetchAndStore(yearMonth);
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
// OPEN ORDERS IMPORT ENDPOINTS
// ============================================

// Import open orders for a specific month
// POST /api/import/open-orders  body: { date: "YYYY-MM-DD" }
app.post('/api/import/open-orders', async (req, res) => {
  const { date } = req.body; // e.g. "2026-02-01"
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required in YYYY-MM-DD format (first of month)' });
  }

  try {
    const yearMonth = date.substring(0, 7);
    const records = await fetchOpenOrders(date);
    const result = await importOpenOrders(records, yearMonth);
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

    const records = await fetchOpenOrders(firstOfMonth);
    const result = await importOpenOrders(records, yearMonth);
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
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required' });
  try {
    const result = await askTessa(question);
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
