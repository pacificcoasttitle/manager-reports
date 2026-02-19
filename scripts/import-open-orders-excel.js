/**
 * Import open orders from an Excel file into the database.
 * Uses title_officer_branches mapping for branch assignment.
 *
 * Usage:
 *   node scripts/import-open-orders-excel.js path/to/file.xlsx 2026-02
 *
 * If month is not provided, it will be inferred from the first Received Date in the file.
 */
require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const pool = require('../database/pool');

function categorizeOrder(orderType, transType) {
  if (!orderType) return 'Unknown';
  const ot = orderType.toLowerCase().trim();
  if (ot === 'trustee sale guarantee') return 'TSG';
  if (ot === 'title & escrow' || ot === 'escrow only') return 'Escrow';
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
  // Handle Excel serial date numbers
  if (typeof val === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + val * 86400000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }
  // Handle JS Date objects or strings
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

async function run() {
  const filePath = process.argv[2];
  let openMonth = process.argv[3]; // optional YYYY-MM

  if (!filePath) {
    console.error('Usage: node scripts/import-open-orders-excel.js <path/to/file.xlsx> [YYYY-MM]');
    console.error('  If YYYY-MM is omitted, it will be inferred from the first Received Date.');
    process.exit(1);
  }

  // Resolve path
  const resolvedPath = path.resolve(filePath);
  console.log(`Reading: ${resolvedPath}`);

  // Load officer branch map
  const { rows: officerRows } = await pool.query(
    'SELECT officer_name, branch FROM title_officer_branches WHERE is_active = true'
  );
  const officerBranchMap = {};
  officerRows.forEach(r => { officerBranchMap[r.officer_name] = r.branch; });
  console.log('Officer branch map:', officerBranchMap);

  // Read Excel
  const wb = XLSX.readFile(resolvedPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  console.log(`Read ${rows.length} rows from Excel`);

  if (rows.length === 0) {
    console.error('No rows found in Excel file.');
    process.exit(1);
  }

  // Infer month from first Received Date if not provided
  if (!openMonth) {
    const firstDate = parseDate(rows[0]['Received Date']);
    if (firstDate) {
      openMonth = firstDate.substring(0, 7);
      console.log(`Inferred open_month from first Received Date: ${openMonth}`);
    } else {
      console.error('Could not infer month — provide YYYY-MM as second argument.');
      process.exit(1);
    }
  }

  console.log(`Target month: ${openMonth}\n`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete existing records for this month
    const deleted = await client.query('DELETE FROM open_orders WHERE open_month = $1', [openMonth]);
    console.log(`Deleted ${deleted.rowCount} existing records for ${openMonth}`);

    let inserted = 0;
    let skipped = 0;

    for (const r of rows) {
      const fileNumber = (String(r['Order Number'] || '')).trim();
      if (!fileNumber) { skipped++; continue; }

      const titleOfficer = (r['Title Officer'] || '').trim() || null;
      const branch = (titleOfficer && officerBranchMap[titleOfficer])
        ? officerBranchMap[titleOfficer]
        : 'Unassigned';

      const orderType = (r['Order Type'] || '').trim();
      const transType = (r['Transaction Type'] || '').trim();
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
        parseDate(r['Received Date']),
        parseDate(r['Settlement Date']),
        transType || null,
        orderType || null,
        (r['Product Type'] || '').trim() || null,
        (r['Profile'] || '').trim() || null,
        branch,
        category,
        (r['Sales Rep'] || '').trim() || null,
        titleOfficer,
        (r['Escrow Officer'] || '').trim() || null,
        (r['Escrow Assistant'] || '').trim() || null,
        (r['Marketing Source'] || '').trim() || null,
        (r['Main Contact'] || '').trim() || null,
        openMonth
      ]);
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`\n✓ Inserted: ${inserted}, Skipped: ${skipped}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // Verification
  const verify = await pool.query(
    'SELECT COUNT(*) FROM open_orders WHERE open_month = $1', [openMonth]
  );
  console.log(`\nVerification: ${verify.rows[0].count} open orders for ${openMonth}`);

  // Branch breakdown (using officer mapping, not stored branch)
  const branches = await pool.query(`
    SELECT 
      COALESCE(tob.branch, 'Unassigned') as branch, 
      COUNT(*) 
    FROM open_orders oo
    LEFT JOIN title_officer_branches tob ON oo.title_officer = tob.officer_name
    WHERE oo.open_month = $1
    GROUP BY tob.branch
    ORDER BY count DESC
  `, [openMonth]);
  console.log('\nBranch breakdown:');
  branches.rows.forEach(r => console.log(`  ${r.branch || 'Unassigned'}: ${r.count}`));

  // Category breakdown
  const cats = await pool.query(`
    SELECT category, COUNT(*) 
    FROM open_orders 
    WHERE open_month = $1 
    GROUP BY category 
    ORDER BY count DESC
  `, [openMonth]);
  console.log('\nCategory breakdown:');
  cats.rows.forEach(r => console.log(`  ${r.category}: ${r.count}`));

  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
