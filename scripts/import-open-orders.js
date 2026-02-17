require('dotenv').config();
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const pool = require('../database/pool');

// Branch detection from file number suffix (same logic as business-logic.js)
function getBranch(fileNumber) {
  if (!fileNumber) return 'Unknown';
  if (fileNumber.startsWith('99') && !fileNumber.includes('-')) return 'TSG';
  const parts = fileNumber.split('-');
  if (parts.length >= 2) {
    const suffix = parts[parts.length - 1].toUpperCase();
    const map = { 'GLT': 'Glendale', 'OCT': 'Orange', 'ONT': 'Inland Empire', 'PRV': 'Porterville' };
    if (map[suffix]) return map[suffix];
  }
  return 'Unknown';
}

// Categorize order (same logic as business-logic.js)
function categorizeOrder(orderType, transType) {
  if (!orderType) return 'Unknown';
  const ot = orderType.toLowerCase().trim();
  if (ot === 'trustee sale guarantee') return 'TSG';
  if (ot === 'title & escrow') return 'Escrow';
  if (ot === 'title only') {
    const tt = (transType || '').toLowerCase().trim();
    if (tt === 'purchase') return 'Purchase';
    if (tt === 'refinance') return 'Refinance';
    return 'Other';
  }
  return 'Unknown';
}

function parseDate(val) {
  if (!val) return null;
  // Handle Excel serial date numbers (days since 1900-01-01, with Excel's leap year bug)
  if (typeof val === 'number') {
    // Excel epoch is Jan 1, 1900 but has a bug treating 1900 as leap year
    // JS Date epoch is Jan 1, 1970. Excel serial 1 = Jan 1, 1900.
    // Subtract 25569 to convert Excel serial to Unix days, then multiply by 86400000 for ms
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // Dec 30, 1899
    const d = new Date(excelEpoch.getTime() + val * 86400000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }
  // Handle string dates
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

async function importFile(filePath) {
  const fileName = path.basename(filePath);
  // Extract month from filename: "2026-01-open.xlsx" -> "2026-01"
  const match = fileName.match(/^(\d{4}-\d{2})-open\.xlsx$/);
  if (!match) {
    console.log(`Skipping ${fileName} — doesn't match YYYY-MM-open.xlsx pattern`);
    return null;
  }
  const openMonth = match[1];

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  console.log(`${openMonth}: ${rows.length} rows found`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Clear existing data for this month (idempotent)
    await client.query('DELETE FROM open_orders WHERE open_month = $1', [openMonth]);

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const fileNumber = (row['Order Number'] || '').trim();
      if (!fileNumber) { skipped++; continue; }

      const transType = (row['Transaction Type'] || '').trim();
      const orderType = (row['Order Type'] || '').trim();

      await client.query(`
        INSERT INTO open_orders (
          file_number, received_date, settlement_date, trans_type, order_type,
          product_type, profile, branch, category, sales_rep, title_officer,
          escrow_officer, escrow_assistant, marketing_source, main_contact, open_month
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
        parseDate(row['Received Date']),
        parseDate(row['Settlement Date']),
        transType || null,
        orderType || null,
        (row['Product Type'] || '').trim() || null,
        (row['Profile'] || '').trim() || null,
        getBranch(fileNumber),
        categorizeOrder(orderType, transType),
        (row['Sales Rep'] || '').trim() || null,
        (row['Title Officer'] || '').trim() || null,
        (row['Escrow Officer'] || '').trim() || null,
        (row['Escrow Assistant'] || '').trim() || null,
        (row['Marketing Source'] || '').trim() || null,
        (row['Main Contact'] || '').trim() || null,
        openMonth
      ]);
      imported++;
    }

    await client.query('COMMIT');
    console.log(`✓ ${openMonth}: ${imported} imported, ${skipped} skipped`);
    return { openMonth, imported, skipped };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✗ ${openMonth}: ${err.message}`);
    return { openMonth, error: err.message };
  } finally {
    client.release();
  }
}

async function main() {
  const dir = path.join(__dirname, '..', 'data', 'open-orders');
  if (!fs.existsSync(dir)) {
    console.error('Directory not found: data/open-orders/');
    console.error('Create it and add YYYY-MM-open.xlsx files.');
    process.exit(1);
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.xlsx'))
    .sort()
    .map(f => path.join(dir, f));

  console.log(`Found ${files.length} Excel files\n`);

  const results = [];
  for (const file of files) {
    const result = await importFile(file);
    if (result) results.push(result);
  }

  console.log('\n=== IMPORT COMPLETE ===');
  for (const r of results) {
    if (r.error) {
      console.log(`  ✗ ${r.openMonth}: ${r.error}`);
    } else {
      console.log(`  ✓ ${r.openMonth}: ${r.imported} orders`);
    }
  }

  await pool.end();
}

main();
