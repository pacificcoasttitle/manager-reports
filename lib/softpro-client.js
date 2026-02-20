const axios = require('axios');
const pool = require('../database/pool');
const { isValidBillCode, aggregateLineItems, categorizeOrder } = require('./business-logic');

const API_BASE = process.env.SOFTPRO_API_BASE || 'http://100.29.181.61:3000/api';

// Bracket-aware getter — API returns keys like [Number], [BillCode], etc.
const g = (r, key) => r[`[${key}]`] !== undefined ? r[`[${key}]`] : r[key];

/**
 * Fetch revenue data from SoftPro API for a given month
 * @param {string} yearMonth - "YYYY-MM" format
 * @returns {object} { lineItems, orders, meta }
 */
async function fetchMonth(yearMonth) {
  const [year, month] = yearMonth.split('-');
  const userPostedDate = `${year}-${month}-01`;
  const url = `${API_BASE}/powerbi/createExcel?userPostedDate=${userPostedDate}`;
  
  console.log(`Fetching: ${url}`);
  const startTime = Date.now();
  
  try {
    const response = await axios.get(url, {
      timeout: 600000, // 10 minutes (API can be slow)
      headers: { 'Content-Type': 'application/json' }
    });
    
    const duration = Date.now() - startTime;
    const data = response.data;
    
    if (data.Status !== 200 || !data.data) {
      throw new Error(`API returned status ${data.Status}: ${data.Message}`);
    }
    
    const rawRecords = data.data;
    console.log(`Received ${rawRecords.length} raw records in ${duration}ms`);
    
    // Filter to valid bill codes only
    // API returns keys wrapped in brackets, e.g. [BillCode]
    const filtered = rawRecords.filter(r => isValidBillCode(r['[BillCode]'] || r['BillCode']));
    console.log(`After bill code filter: ${filtered.length} records (filtered out ${rawRecords.length - filtered.length})`);
    
    // Map to our schema using bracket-aware getter
    
    const lineItems = filtered.map(r => ({
      file_number: (g(r, 'Number') || '').trim(),
      transaction_date: parseDate(g(r, 'TransactionDate')),
      bill_code: (g(r, 'BillCode') || '').trim(),
      bill_code_category: g(r, 'BillCodeCategory') || null,
      charge_description: g(r, 'ChargeDescription') || null,
      sum_amount: parseFloat(g(r, 'SumAmount')) || 0,
      sales_rep: (g(r, 'SalesRep') || '').trim() || null,
      title_officer: (g(r, 'TitleOfficerName') || '').trim() || null,
      escrow_officer: (g(r, 'EscrowOfficerName') || '').trim() || null,
      order_type: (g(r, 'OrderType') || '').trim() || null,
      trans_type: (g(r, 'TransType') || '').trim() || null,
      title_office: g(r, 'TitleOffice') || null,
      escrow_office: g(r, 'EscrowOffice') || null,
      property_type: g(r, 'PropertyType') || null,
      county: g(r, 'County') || null,
      city: g(r, 'City') || null,
      state: g(r, 'PropState') || null,
      zip: g(r, 'Zip') || null,
      address: g(r, 'Address1') || null,
      full_address: g(r, 'FullAddress') || null,
      marketing_source: g(r, 'MarketingSource') || null,
      main_contact: g(r, 'MainContact') || null,
      underwriter: g(r, 'Underwriter') || null,
      disbursement_date: parseDate(g(r, 'DisbursementDate')),
      escrow_closed_date: parseDate(g(r, 'EscrowClosedDate')),
      received_date: parseDate(g(r, 'ReceivedDate')),
      fetch_month: yearMonth
    }));
    
    // Aggregate into order-level summaries
    const orders = aggregateLineItems(lineItems);
    
    const meta = {
      fetch_month: yearMonth,
      records_fetched: rawRecords.length,
      filtered_records: filtered.length,
      unique_orders: orders.length,
      total_revenue: orders.reduce((sum, o) => sum + o.total_revenue, 0),
      duration_ms: duration
    };
    
    console.log(`Aggregated into ${orders.length} unique orders, total revenue: $${meta.total_revenue.toFixed(2)}`);
    
    return { lineItems, orders, meta };
    
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`Fetch failed after ${duration}ms:`, err.message);
    throw err;
  }
}

/**
 * Fetch and store a month's data in the database
 */
async function fetchAndStore(yearMonth) {
  const client = await pool.connect();
  
  try {
    const { lineItems, orders, meta } = await fetchMonth(yearMonth);
    
    await client.query('BEGIN');
    
    // Clear existing data for this month (idempotent re-fetch)
    await client.query('DELETE FROM revenue_line_items WHERE fetch_month = $1', [yearMonth]);
    await client.query('DELETE FROM order_summary WHERE fetch_month = $1', [yearMonth]);
    
    // Insert line items
    for (const item of lineItems) {
      await client.query(`
        INSERT INTO revenue_line_items (
          file_number, transaction_date, bill_code, bill_code_category,
          charge_description, sum_amount, sales_rep, title_officer, escrow_officer,
          order_type, trans_type, title_office, escrow_office, property_type,
          county, city, state, zip, address, full_address,
          marketing_source, main_contact, underwriter,
          disbursement_date, escrow_closed_date, received_date, fetch_month
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      `, [
        item.file_number, item.transaction_date, item.bill_code, item.bill_code_category,
        item.charge_description, item.sum_amount, item.sales_rep, item.title_officer, item.escrow_officer,
        item.order_type, item.trans_type, item.title_office, item.escrow_office, item.property_type,
        item.county, item.city, item.state, item.zip, item.address, item.full_address,
        item.marketing_source, item.main_contact, item.underwriter,
        item.disbursement_date, item.escrow_closed_date, item.received_date, item.fetch_month
      ]);
    }
    
    // Insert order summaries
    for (const order of orders) {
      await client.query(`
        INSERT INTO order_summary (
          file_number, branch, order_type, trans_type, category,
          sales_rep, title_officer, escrow_officer,
          title_revenue, escrow_revenue, tsg_revenue, underwriter_revenue, total_revenue,
          transaction_date, received_date, disbursement_date, escrow_closed_date,
          fetch_month, line_item_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `, [
        order.file_number, order.branch, order.order_type, order.trans_type, order.category,
        order.sales_rep, order.title_officer, order.escrow_officer,
        order.title_revenue, order.escrow_revenue, order.tsg_revenue, order.underwriter_revenue, order.total_revenue,
        order.transaction_date, order.received_date, order.disbursement_date, order.escrow_closed_date,
        yearMonth, order.line_item_count
      ]);
    }
    
    // Log the fetch
    await client.query(`
      INSERT INTO fetch_log (fetch_month, records_fetched, unique_orders, total_revenue, status, duration_ms)
      VALUES ($1, $2, $3, $4, 'success', $5)
    `, [yearMonth, meta.records_fetched, meta.unique_orders, meta.total_revenue, meta.duration_ms]);
    
    await client.query('COMMIT');
    console.log(`Stored ${lineItems.length} line items and ${orders.length} orders for ${yearMonth}`);
    
    return meta;
    
  } catch (err) {
    await client.query('ROLLBACK');
    
    // Log the failure
    await pool.query(`
      INSERT INTO fetch_log (fetch_month, status, error_message)
      VALUES ($1, 'error', $2)
    `, [yearMonth, err.message]);
    
    throw err;
  } finally {
    client.release();
  }
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ============================================
// OPEN ORDERS: Fetch from SoftPro API (getOpeningData)
// API confirmed working Feb 2026 — returns 1 record per order, no dedup needed
// Field names: [Number], [RedcdDate], [SettDate], [TransType], [OrderType],
//   [ProductType], [ProfileName], [SalesRep], [TitleOfficer], [EscrowOfficer],
//   [EscrowAssistant], [MarketingSource], [MainContact]
// ============================================

/**
 * Fetch open orders from SoftPro API for a given date
 * @param {string} date - "YYYY-MM-DD" format (first of month)
 * @returns {Array} order records (1 per order, no dedup needed)
 */
async function fetchOpenOrders(date) {
  const url = `${API_BASE}/powerbi/getOpeningData?userPostedDate=${date}`;
  console.log(`Fetching open orders for ${date} from ${url}`);
  const startTime = Date.now();

  try {
    const response = await axios.get(url, {
      timeout: 600000, // 10 minutes
      headers: { 'Content-Type': 'application/json' }
    });

    const duration = Date.now() - startTime;
    const data = response.data;

    if ((data.Status !== 200 && data.status !== 200) || !data.data) {
      throw new Error(`SoftPro API error: ${data.Message || data.message || 'Unknown error'}`);
    }

    const records = data.data;
    console.log(`Open orders API returned ${records.length} orders in ${duration}ms`);

    return records;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`Open orders fetch failed after ${duration}ms:`, err.message);
    throw err;
  }
}

/**
 * Import open orders into database for a given month
 * Deletes existing records for the month and inserts fresh data
 * Uses title_officer_branches mapping for branch assignment
 *
 * Updated field mapping (confirmed Feb 2026):
 *   [Number] → file_number, [RedcdDate] → received_date, [SettDate] → settlement_date,
 *   [TransType] → trans_type, [OrderType] → order_type, [ProductType] → product_type,
 *   [ProfileName] → profile, [SalesRep] → sales_rep, [TitleOfficer] → title_officer,
 *   [EscrowOfficer] → escrow_officer, [EscrowAssistant], [MarketingSource], [MainContact]
 *
 * @param {Array} records - order records from fetchOpenOrders
 * @param {string} yearMonth - "YYYY-MM" format
 * @returns {object} { inserted, skipped, deleted, month }
 */
async function importOpenOrders(records, yearMonth) {
  // Load officer branch map for branch assignment
  const { rows: officerRows } = await pool.query(
    'SELECT officer_name, branch FROM title_officer_branches WHERE is_active = true'
  );
  const officerBranchMap = {};
  officerRows.forEach(r => { officerBranchMap[r.officer_name] = r.branch; });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete existing records for this month (full replace, idempotent)
    const deleted = await client.query('DELETE FROM open_orders WHERE open_month = $1', [yearMonth]);
    console.log(`Deleted ${deleted.rowCount} existing open orders for ${yearMonth}`);

    let inserted = 0;
    let skipped = 0;

    for (const r of records) {
      const fileNumber = (g(r, 'Number') || '').trim();
      if (!fileNumber) { skipped++; continue; }

      const titleOfficer = (g(r, 'TitleOfficer') || '').trim() || null;
      const branch = (titleOfficer && officerBranchMap[titleOfficer])
        ? officerBranchMap[titleOfficer]
        : 'Unassigned';

      const orderType = (g(r, 'OrderType') || '').trim();
      const transType = (g(r, 'TransType') || '').trim();
      const category = categorizeOrder(orderType, transType);

      await client.query(`
        INSERT INTO open_orders
          (file_number, received_date, settlement_date, trans_type, order_type,
           product_type, profile, branch, category, sales_rep, title_officer,
           escrow_officer, escrow_assistant, marketing_source, main_contact, open_month)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (file_number, open_month) DO UPDATE SET
          received_date = EXCLUDED.received_date,
          settlement_date = EXCLUDED.settlement_date,
          trans_type = EXCLUDED.trans_type,
          order_type = EXCLUDED.order_type,
          product_type = EXCLUDED.product_type,
          profile = EXCLUDED.profile,
          branch = EXCLUDED.branch,
          category = EXCLUDED.category,
          sales_rep = EXCLUDED.sales_rep,
          title_officer = EXCLUDED.title_officer,
          escrow_officer = EXCLUDED.escrow_officer,
          escrow_assistant = EXCLUDED.escrow_assistant,
          marketing_source = EXCLUDED.marketing_source,
          main_contact = EXCLUDED.main_contact
      `, [
        fileNumber,
        parseDate(g(r, 'RedcdDate')),        // received_date
        parseDate(g(r, 'SettDate')),          // settlement_date
        transType || null,
        orderType || null,
        (g(r, 'ProductType') || '').trim() || null,
        (g(r, 'ProfileName') || '').trim() || null,  // profile
        branch,
        category,
        (g(r, 'SalesRep') || '').trim() || null,
        titleOfficer,
        (g(r, 'EscrowOfficer') || '').trim() || null,
        (g(r, 'EscrowAssistant') || '').trim() || null,
        (g(r, 'MarketingSource') || '').trim() || null,
        (g(r, 'MainContact') || '').trim() || null,
        yearMonth
      ]);
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`✓ ${yearMonth}: ${inserted} open orders imported, ${skipped} skipped, ${deleted.rowCount} replaced`);
    return { inserted, skipped, deleted: deleted.rowCount, month: yearMonth };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✗ ${yearMonth}: open orders import failed — ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { fetchMonth, fetchAndStore, fetchOpenOrders, importOpenOrders };
