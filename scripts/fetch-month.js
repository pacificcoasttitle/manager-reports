/**
 * Fetch a single month from SoftPro API and store in database
 * Usage: node scripts/fetch-month.js 2026-02
 */
require('dotenv').config();
const { fetchAndStore } = require('../lib/softpro-client');
const pool = require('../database/pool');

async function main() {
  const yearMonth = process.argv[2];
  
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    console.error('Usage: node scripts/fetch-month.js YYYY-MM');
    console.error('Example: node scripts/fetch-month.js 2026-02');
    process.exit(1);
  }
  
  console.log(`\nFetching revenue data for ${yearMonth}...`);
  console.log('This may take several minutes (API timeout is 10 minutes).\n');
  
  try {
    const meta = await fetchAndStore(yearMonth);
    console.log('\n=== FETCH COMPLETE ===');
    console.log(`Records from API: ${meta.records_fetched}`);
    console.log(`After bill code filter: ${meta.filtered_records}`);
    console.log(`Unique orders: ${meta.unique_orders}`);
    console.log(`Total revenue: $${meta.total_revenue.toFixed(2)}`);
    console.log(`Duration: ${(meta.duration_ms / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('Fetch failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
