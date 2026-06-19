require('dotenv').config();
const reports = require('../lib/reports');
(async () => {
  const data = await reports.escrowOfficerProduction(5, 2026);
  let grandMtd = 0, grandCnt = 0;
  for (const branch of Object.keys(data.report)) {
    let bMtd = 0, bCnt = 0;
    console.log(`\nBranch ${branch}:`);
    for (const officer of Object.keys(data.report[branch])) {
      const r = data.report[branch][officer];
      bMtd += r.mtd_rev; bCnt += r.mtd_cnt;
      console.log(`  ${officer}: cnt=${r.mtd_cnt} rev=$${r.mtd_rev.toFixed(2)}`);
    }
    console.log(`  ${branch} subtotal: cnt=${bCnt} rev=$${bMtd.toFixed(2)}`);
    grandMtd += bMtd; grandCnt += bCnt;
  }
  console.log(`\nGRAND TOTAL: cnt=${grandCnt} mtd_rev=$${grandMtd.toFixed(2)}`);
  process.exit(0);
})();
