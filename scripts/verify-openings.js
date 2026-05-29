require('dotenv').config();
const pool = require('../database/pool');
const reports = require('../lib/reports');

function sumMtd(report) {
  let t = 0, today = 0, prior = 0;
  for (const b of Object.keys(report)) {
    for (const k of Object.keys(report[b])) {
      t += report[b][k].mtd_cnt;
      today += report[b][k].today_cnt;
      prior += report[b][k].prior_cnt;
    }
  }
  return { mtd: t, today, prior };
}

async function sqlCount(where) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM open_orders WHERE open_month = '2026-05'
       AND file_number NOT ILIKE 'test%'
       AND file_number NOT ILIKE 'ar test%'
       AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)
       ${where}`
  );
  return rows[0].c;
}

(async () => {
  const M = 5, Y = 2026;
  const cases = [
    ['titleOfficerOpenings', `AND LOWER(order_type) IN ('title only', 'title & escrow')`],
    ['escrowProductionOpenings', `AND LOWER(order_type) IN ('title & escrow', 'escrow only')`],
    ['escrowOfficerOpenings', `AND LOWER(order_type) IN ('title & escrow', 'escrow only')`],
    ['tsgProductionOpenings', `AND LOWER(order_type) = 'trustee sale guarantee'`],
    ['r14BranchesOpenings', ``],
    ['r14RankingOpenings', ``],
    ['dailyRevenueOpenings', `AND LOWER(order_type) IN ('title only', 'title & escrow')`],
  ];
  for (const [fn, where] of cases) {
    const data = await reports[fn](M, Y);
    const s = sumMtd(data.report);
    const truth = await sqlCount(where);
    const note = fn === 'dailyRevenueOpenings'
      ? '(may differ from truth: only Purchase/Refinance buckets count)'
      : '';
    const ok = s.mtd === truth || note;
    console.log(`${fn.padEnd(26)} mtd=${String(s.mtd).padStart(5)} today=${s.today} prior=${s.prior}  SQL truth=${truth}  ${s.mtd === truth ? 'MATCH' : 'DIFF ' + note}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
