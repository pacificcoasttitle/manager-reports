require('dotenv').config();
const reports = require('../lib/reports');
(async () => {
  const data = await reports.escrowProduction(5, 2026);
  let grandMtd = 0, grandCnt = 0;
  for (const branch of Object.keys(data.report)) {
    let bMtd = 0, bCnt = 0;
    for (const rep of Object.keys(data.report[branch])) {
      const r = data.report[branch][rep];
      bMtd += r.mtd_rev; bCnt += r.mtd_cnt;
      if (rep === 'Corey Velasquez') {
        console.log('Corey Velasquez =>', r);
      }
    }
    console.log(`Branch ${branch}: MTD cnt=${bCnt}, MTD rev=$${bMtd.toFixed(2)}`);
    grandMtd += bMtd; grandCnt += bCnt;
  }
  console.log(`\nGRAND TOTAL: cnt=${grandCnt}, MTD rev=$${grandMtd.toFixed(2)}`);
  process.exit(0);
})();
