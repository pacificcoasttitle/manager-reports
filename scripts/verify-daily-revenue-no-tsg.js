require('dotenv').config();
const reports = require('../lib/reports');
(async () => {
  const data = await reports.dailyRevenue(5, 2026);
  let grandMtd = 0, grandCnt = 0;
  const branchKeys = Object.keys(data.report);
  let foundTsgKey = false;
  for (const branch of branchKeys) {
    const cats = Object.keys(data.report[branch]).filter(k => k !== 'totals');
    if (cats.includes('TSG')) foundTsgKey = true;
    let bMtd = 0, bCnt = 0;
    for (const cat of cats) {
      const c = data.report[branch][cat];
      bMtd += c.mtd_rev || 0;
      bCnt += c.mtd_closed || 0;
    }
    console.log(`Branch ${branch} (cats: ${cats.join(', ')}): cnt=${bCnt} mtd=$${bMtd.toFixed(2)}`);
    grandMtd += bMtd; grandCnt += bCnt;
  }
  console.log('\nGRAND TOTAL: cnt=' + grandCnt + ' mtd=$' + grandMtd.toFixed(2));
  console.log('data.grandTotal:', { mtd_closed: data.grandTotal.mtd_closed, mtd_rev: +data.grandTotal.mtd_rev.toFixed(2) });
  console.log('\nAssertions:');
  console.log('  - No TSG category key:', foundTsgKey ? 'FAIL' : 'PASS');
  console.log('  - Grand total = $1,020,793.80:', Math.abs(grandMtd - 1020793.80) < 0.01 ? 'PASS' : 'FAIL (got $' + grandMtd.toFixed(2) + ')');
  console.log('  - Order count = 524:', grandCnt === 524 ? 'PASS' : 'FAIL (got ' + grandCnt + ')');
  process.exit(0);
})();
