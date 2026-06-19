// Inspect API responses for open-count fields
function listFields(obj, path='') {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj);
}

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const daily = require(path.join(ROOT, 'api-daily.json'));
const title = require(path.join(ROOT, 'api-title.json'));
const esc = require(path.join(ROOT, 'api-esc.json'));
const escOff = require(path.join(ROOT, 'api-esc-officer.json'));
const tsg = require(path.join(ROOT, 'api-tsg.json'));
const r14 = require(path.join(ROOT, 'api-r14.json'));

console.log('\n=== 1. /api/reports/daily-revenue (Title Revenue tab) ===');
const dailyBranches = Object.keys(daily.report);
console.log('Branches:', dailyBranches);
const firstBranch = dailyBranches.find(b => b !== 'totals' && b !== 'Unassigned') || dailyBranches[0];
const sample = daily.report[firstBranch];
console.log(`Sample branch "${firstBranch}" keys:`, Object.keys(sample));
const cat = Object.keys(sample).find(k => k !== 'totals');
console.log(`  category "${cat}" fields:`, Object.keys(sample[cat] || {}));
console.log(`  totals fields:`, Object.keys(sample.totals || {}));
let totalMtdOpen=0, totalTodayOpen=0, totalPriorOpen=0;
for (const b of dailyBranches) {
  const t = daily.report[b].totals || {};
  totalMtdOpen += t.mtd_open || 0;
  totalTodayOpen += t.today_open || 0;
  totalPriorOpen += t.prior_open || 0;
}
console.log(`Sum across branches: today_open=${totalTodayOpen}, mtd_open=${totalMtdOpen}, prior_open=${totalPriorOpen}`);
console.log(`grandTotal:`, daily.grandTotal);

console.log('\n=== 2. /api/reports/title-officer (Title Officer Production) ===');
const titleBranches = Object.keys(title.report);
console.log('Branches:', titleBranches);
const tFirstBranch = titleBranches[0];
const tFirstOfficer = Object.keys(title.report[tFirstBranch])[0];
const tSample = title.report[tFirstBranch][tFirstOfficer];
console.log(`Sample officer "${tFirstOfficer}" top-level keys:`, Object.keys(tSample));
if (tSample.Purchase) console.log(`  Purchase keys:`, Object.keys(tSample.Purchase));
if (tSample.totals) console.log(`  totals keys:`, Object.keys(tSample.totals));
let titleTodayOpen=0, titleMtdOpen=0, titlePriorOpen=0, titleOpen4m=0;
for (const b of titleBranches) for (const o of Object.keys(title.report[b])) {
  const e = title.report[b][o];
  titleTodayOpen += e.today_open || (e.totals && e.totals.today_open) || 0;
  titleMtdOpen += e.mtd_open || (e.totals && e.totals.mtd_open) || 0;
  titlePriorOpen += e.prior_open || (e.totals && e.totals.prior_open) || 0;
  titleOpen4m += e.created_4m || 0;
}
console.log(`Officer-level today_open=${titleTodayOpen}, mtd_open=${titleMtdOpen}, prior_open=${titlePriorOpen}, sum(created_4m)=${titleOpen4m}`);

console.log('\n=== 3. /api/reports/escrow-production (By Sales Rep) ===');
const escBranches = Object.keys(esc.report);
console.log('Branches:', escBranches);
const eFirstBranch = escBranches[0];
const eFirstRep = Object.keys(esc.report[eFirstBranch])[0];
const eSample = esc.report[eFirstBranch][eFirstRep];
console.log(`Sample rep "${eFirstRep}" keys:`, Object.keys(eSample));
let escTodayOpen=0, escMtdOpen=0, escPriorOpen=0, escOpen4m=0;
for (const b of escBranches) for (const r of Object.keys(esc.report[b])) {
  const e = esc.report[b][r];
  escTodayOpen += e.today_open || 0;
  escMtdOpen += e.mtd_open || 0;
  escPriorOpen += e.prior_open || 0;
  escOpen4m += e.created_4m || 0;
}
console.log(`today_open=${escTodayOpen}, mtd_open=${escMtdOpen}, prior_open=${escPriorOpen}, sum(created_4m)=${escOpen4m}`);

console.log('\n=== 4. /api/reports/escrow-officer-production (By Escrow Officer) ===');
const eoBranches = Object.keys(escOff.report);
console.log('Branches:', eoBranches);
const eoFirstBranch = eoBranches[0];
const eoFirstOfficer = Object.keys(escOff.report[eoFirstBranch])[0];
const eoSample = escOff.report[eoFirstBranch][eoFirstOfficer];
console.log(`Sample officer "${eoFirstOfficer}" keys:`, Object.keys(eoSample));
let eoTodayOpen=0, eoMtdOpen=0, eoPriorOpen=0, eoOpen4m=0;
for (const b of eoBranches) for (const o of Object.keys(escOff.report[b])) {
  const e = escOff.report[b][o];
  eoTodayOpen += e.today_open || 0;
  eoMtdOpen += e.mtd_open || 0;
  eoPriorOpen += e.prior_open || 0;
  eoOpen4m += e.created_4m || 0;
}
console.log(`today_open=${eoTodayOpen}, mtd_open=${eoMtdOpen}, prior_open=${eoPriorOpen}, sum(created_4m)=${eoOpen4m}`);

console.log('\n=== 5. /api/reports/tsg-production ===');
const tsgBranches = Object.keys(tsg.report);
console.log('Branches:', tsgBranches);
const tsgFirstBranch = tsgBranches[0];
const tsgFirstRep = Object.keys(tsg.report[tsgFirstBranch] || {})[0];
const tsgSample = tsg.report[tsgFirstBranch][tsgFirstRep];
console.log(`Sample rep "${tsgFirstRep}" keys:`, Object.keys(tsgSample));
let tsgTodayOpen=0, tsgMtdOpen=0, tsgPriorOpen=0, tsgOpen4m=0;
for (const b of tsgBranches) for (const r of Object.keys(tsg.report[b])) {
  const e = tsg.report[b][r];
  tsgTodayOpen += e.today_open || 0;
  tsgMtdOpen += e.mtd_open || 0;
  tsgPriorOpen += e.prior_open || 0;
  tsgOpen4m += e.created_4m || 0;
}
console.log(`today_open=${tsgTodayOpen}, mtd_open=${tsgMtdOpen}, prior_open=${tsgPriorOpen}, sum(created_4m)=${tsgOpen4m}`);

console.log('\n=== 6. /api/reports/r14-branches ===');
const r14Branches = Object.keys(r14.report);
console.log('Branches:', r14Branches);
const rFirstBranch = r14Branches[0];
const rFirstRep = Object.keys(r14.report[rFirstBranch])[0];
const rSample = r14.report[rFirstBranch][rFirstRep];
console.log(`Sample rep "${rFirstRep}" top-level keys:`, Object.keys(rSample));
if (rSample.Purchase) console.log(`  Purchase keys:`, Object.keys(rSample.Purchase));
if (rSample.totals) console.log(`  totals keys:`, Object.keys(rSample.totals));
let r14TodayOpen=0, r14MtdOpen=0, r14PriorOpen=0, r14Open4m=0;
for (const b of r14Branches) for (const rep of Object.keys(r14.report[b])) {
  const e = r14.report[b][rep];
  r14TodayOpen += e.today_open || (e.totals && e.totals.today_open) || 0;
  r14MtdOpen += e.mtd_open || (e.totals && e.totals.mtd_open) || 0;
  r14PriorOpen += e.prior_open || (e.totals && e.totals.prior_open) || 0;
  r14Open4m += e.created_4m || 0;
}
console.log(`today_open=${r14TodayOpen}, mtd_open=${r14MtdOpen}, prior_open=${r14PriorOpen}, sum(created_4m)=${r14Open4m}`);
