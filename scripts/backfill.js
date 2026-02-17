/**
 * Backfill multiple months of revenue data
 * Usage: node scripts/backfill.js 2025-01 2026-02
 * This fetches every month from start to end (inclusive)
 */
require('dotenv').config();
const { fetchAndStore } = require('../lib/softpro-client');
const pool = require('../database/pool');

async function main() {
  const start = process.argv[2];
  const end = process.argv[3];
  
  if (!start || !end || !/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) {
    console.error('Usage: node scripts/backfill.js YYYY-MM YYYY-MM');
    console.error('Example: node scripts/backfill.js 2025-01 2026-02');
    process.exit(1);
  }
  
  // Generate list of months
  const months = [];
  let [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  
  while (sy < ey || (sy === ey && sm <= em)) {
    months.push(`${sy}-${String(sm).padStart(2, '0')}`);
    sm++;
    if (sm > 12) { sm = 1; sy++; }
  }
  
  console.log(`\nBackfilling ${months.length} months: ${months[0]} to ${months[months.length - 1]}`);
  console.log('Each fetch may take several minutes.\n');
  
  const results = [];
  
  for (const month of months) {
    console.log(`\n--- Fetching ${month} ---`);
    try {
      const meta = await fetchAndStore(month);
      results.push({ month, status: 'success', ...meta });
      console.log(`✓ ${month}: ${meta.unique_orders} orders, $${meta.total_revenue.toFixed(2)}`);
    } catch (err) {
      results.push({ month, status: 'error', error: err.message });
      console.error(`✗ ${month}: ${err.message}`);
    }
    
    // Small delay between requests to be nice to the API
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n=== BACKFILL COMPLETE ===');
  console.log('Results:');
  for (const r of results) {
    if (r.status === 'success') {
      console.log(`  ✓ ${r.month}: ${r.unique_orders} orders, $${r.total_revenue.toFixed(2)}`);
    } else {
      console.log(`  ✗ ${r.month}: ${r.error}`);
    }
  }
  
  await pool.end();
}

main();
