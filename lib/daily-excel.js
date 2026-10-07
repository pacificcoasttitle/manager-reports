const ExcelJS = require('exceljs');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');
const reports = require('./reports');
const { countWorkingDays } = require('./business-logic');

const MASTER_PATH = path.join(__dirname, '..', 'docs', 'templates', 'Daily_Report_Master.xlsx');
const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TEST_EMAIL = process.env.DAILY_EXCEL_TEST_EMAIL || 'ghernandez@pct.com';
const BUCKETS = ['Purchase', 'Refinance', 'TSG'];
const R14_INPUT_COLUMNS = ['E','F','G','J','K','L','O','Q','R','S','V','W','X','Z','AA','AB','AC','AD','AH','AI','AJ','AL','AM'];
const R14_SLOT_ROWS = [
  ...Array.from({ length: 37 }, (_, i) => i + 9),
  ...Array.from({ length: 35 }, (_, i) => i + 49),
];
const R14_ALIASES = {
  'Dan Culnane - TSG': 'Dan Culnane',
  'John Thaete - TSG': 'John Thaete',
};
const ESCROW_SLOTS = [
  { name: 'Joseph Gomez', heading: 19, sale: 20, refi: 21, total: 25 },
  { name: 'Lupe Vidaca', heading: 43, sale: 44, refi: 45, total: 46 },
  { name: 'Christine Quintanar', heading: 54, sale: 55, refi: 56, total: 57 },
  { name: 'Analleli Ayala', heading: 58, sale: 59, refi: 60, total: 61 },
  { name: 'Anna Ballesteros', heading: 66, sale: 67, refi: 68, total: 69 },
  { name: 'Karla Casco', heading: 71, sale: 72, refi: 73, total: 77 },
];
const HISTORY_ROWS = {
  Glendale: 20,
  Orange: 33,
  TSG: 39,
  Porterville: 41,
  'Inland Empire': 44,
  'Total Company': 53,
};

function num(value) {
  return Number.parseFloat(value) || 0;
}

function roundMoney(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function pacificDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('date must use YYYY-MM-DD');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('date is invalid');
  }
  return parsed;
}

function shiftDate(value, days) {
  const parsed = parseDateOnly(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function shiftMonth(yearMonth, amount) {
  const parsed = new Date(`${yearMonth}-01T12:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + amount);
  return parsed.toISOString().slice(0, 7);
}

function monthParts(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return { year, month };
}

function monthEnd(yearMonth) {
  const { year, month } = monthParts(yearMonth);
  return new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
}

function monthSequence(startMonth, endMonth) {
  const months = [];
  for (let cursor = startMonth; cursor <= endMonth; cursor = shiftMonth(cursor, 1)) months.push(cursor);
  return months;
}

function emptyBucket() {
  return {
    openings: { day: 0, mtd: 0, prior: 0, prior2: 0 },
    closings: { day: 0, mtd: 0, prior: 0, prior2: 0 },
    revenue: { day: 0, mtd: 0, prior: 0, prior2: 0 },
  };
}

function emptyEntity() {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, emptyBucket()]));
}

function ensureEntity(map, name) {
  if (!map[name]) map[name] = emptyEntity();
  return map[name];
}

function addEntity(target, source) {
  for (const bucket of BUCKETS) {
    for (const metric of ['openings', 'closings', 'revenue']) {
      for (const period of ['day', 'mtd', 'prior', 'prior2']) {
        target[bucket][metric][period] += num(source?.[bucket]?.[metric]?.[period]);
      }
    }
  }
  return target;
}

function entityHasActivity(entity) {
  return BUCKETS.some((bucket) =>
    ['openings', 'closings', 'revenue'].some((metric) =>
      ['day', 'mtd', 'prior'].some((period) => Math.abs(num(entity[bucket][metric][period])) > 0.0001)
    )
  );
}

const BRANCH_SQL = (column) => `CASE
  WHEN ${column} LIKE '%-GLT' THEN 'Glendale'
  WHEN ${column} LIKE '%-OCT' THEN 'Orange'
  WHEN ${column} LIKE '%-ONT' THEN 'Inland Empire'
  WHEN ${column} LIKE '%-PRV' THEN 'Porterville'
  WHEN ${column} LIKE '%-TSG' OR ${column} LIKE '99%' THEN 'TSG'
  ELSE 'Unassigned'
END`;

const REP_BUCKET_SQL = `CASE
  WHEN category = 'TSG' OR LOWER(COALESCE(order_type, '')) = 'trustee sale guarantee' THEN 'TSG'
  WHEN LOWER(TRIM(COALESCE(trans_type, ''))) = 'refinance' THEN 'Refinance'
  ELSE 'Purchase'
END`;

async function loadRepMetrics({ currentMonth, priorMonth, prior2Month, reportDate }) {
  const [openResult, closeResult] = await Promise.all([
    pool.query(`
      SELECT COALESCE(NULLIF(TRIM(sales_rep), ''), 'Unassigned') AS name,
             ${REP_BUCKET_SQL} AS bucket,
             COUNT(*) FILTER (WHERE received_date::date = $4::date)::int AS day_count,
             COUNT(*) FILTER (WHERE open_month = $1 AND received_date::date <= $4::date)::int AS mtd_count,
             COUNT(*) FILTER (WHERE open_month = $2)::int AS prior_count,
             COUNT(*) FILTER (WHERE open_month = $3)::int AS prior2_count,
             COUNT(*) FILTER (
               WHERE open_month = $1 AND received_date::date <= $4::date
                 AND (trans_type IS NULL OR TRIM(trans_type) = '')
                 AND NOT (category = 'TSG' OR LOWER(COALESCE(order_type, '')) = 'trustee sale guarantee')
             )::int AS null_type_mtd
      FROM open_orders
      WHERE open_month IN ($1, $2, $3)
        AND category IN ('Purchase', 'Refinance', 'TSG')
        AND file_number NOT ILIKE 'test%'
        AND file_number NOT ILIKE 'ar test%'
        AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)
      GROUP BY COALESCE(NULLIF(TRIM(sales_rep), ''), 'Unassigned'), ${REP_BUCKET_SQL}
    `, [currentMonth, priorMonth, prior2Month, reportDate]),
    pool.query(`
      SELECT COALESCE(NULLIF(TRIM(sales_rep), ''), 'Unassigned') AS name,
             ${REP_BUCKET_SQL} AS bucket,
             COUNT(*) FILTER (
               WHERE transaction_date::date = $4::date
                 AND category IN ('Purchase', 'Refinance', 'TSG')
             )::int AS day_count,
             COUNT(*) FILTER (
               WHERE fetch_month = $1 AND transaction_date::date <= $4::date
                 AND category IN ('Purchase', 'Refinance', 'TSG')
             )::int AS mtd_count,
             COUNT(*) FILTER (
               WHERE fetch_month = $2 AND category IN ('Purchase', 'Refinance', 'TSG')
             )::int AS prior_count,
             COUNT(*) FILTER (
               WHERE fetch_month = $3 AND category IN ('Purchase', 'Refinance', 'TSG')
             )::int AS prior2_count,
             ROUND(SUM(
               CASE WHEN transaction_date::date = $4::date THEN
                 CASE WHEN (${REP_BUCKET_SQL}) = 'TSG'
                      THEN COALESCE(tsg_revenue, 0)
                      ELSE COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) END
               ELSE 0 END
             )::numeric, 2) AS day_revenue,
             ROUND(SUM(
               CASE WHEN fetch_month = $1 AND transaction_date::date <= $4::date THEN
                 CASE WHEN (${REP_BUCKET_SQL}) = 'TSG'
                      THEN COALESCE(tsg_revenue, 0)
                      ELSE COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) END
               ELSE 0 END
             )::numeric, 2) AS mtd_revenue,
             ROUND(SUM(
               CASE WHEN fetch_month = $2 THEN
                 CASE WHEN (${REP_BUCKET_SQL}) = 'TSG'
                      THEN COALESCE(tsg_revenue, 0)
                      ELSE COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) END
               ELSE 0 END
             )::numeric, 2) AS prior_revenue,
             ROUND(SUM(
               CASE WHEN fetch_month = $3 THEN
                 CASE WHEN (${REP_BUCKET_SQL}) = 'TSG'
                      THEN COALESCE(tsg_revenue, 0)
                      ELSE COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) END
               ELSE 0 END
             )::numeric, 2) AS prior2_revenue
      FROM order_summary
      WHERE fetch_month IN ($1, $2, $3)
        AND transaction_date IS NOT NULL
        AND category IN ('Purchase', 'Refinance', 'Escrow', 'TSG')
      GROUP BY COALESCE(NULLIF(TRIM(sales_rep), ''), 'Unassigned'), ${REP_BUCKET_SQL}
    `, [currentMonth, priorMonth, prior2Month, reportDate]),
  ]);

  const entities = {};
  let nullTransactionTypeCount = 0;
  for (const row of openResult.rows) {
    const bucket = row.bucket;
    if (!BUCKETS.includes(bucket)) continue;
    const entry = ensureEntity(entities, row.name)[bucket];
    entry.openings.day = num(row.day_count);
    entry.openings.mtd = num(row.mtd_count);
    entry.openings.prior = num(row.prior_count);
    entry.openings.prior2 = num(row.prior2_count);
    nullTransactionTypeCount += num(row.null_type_mtd);
  }
  for (const row of closeResult.rows) {
    const bucket = row.bucket;
    if (!BUCKETS.includes(bucket)) continue;
    const entry = ensureEntity(entities, row.name)[bucket];
    entry.closings.day = num(row.day_count);
    entry.closings.mtd = num(row.mtd_count);
    entry.closings.prior = num(row.prior_count);
    entry.closings.prior2 = num(row.prior2_count);
    entry.revenue.day = num(row.day_revenue);
    entry.revenue.mtd = num(row.mtd_revenue);
    entry.revenue.prior = num(row.prior_revenue);
    entry.revenue.prior2 = num(row.prior2_revenue);
  }
  return { entities, nullTransactionTypeCount };
}

async function loadEscrowOfficerMetrics({ currentMonth, priorMonth, prior2Month, reportDate }) {
  const bucketSql = `CASE WHEN LOWER(TRIM(COALESCE(trans_type, ''))) = 'refinance' THEN 'Refinance' ELSE 'Purchase' END`;
  const [openResult, closeResult] = await Promise.all([
    pool.query(`
      SELECT COALESCE(NULLIF(TRIM(escrow_officer), ''), '(Unassigned)') AS name,
             ${bucketSql} AS bucket,
             COUNT(*) FILTER (WHERE received_date::date = $4::date)::int AS day_count,
             COUNT(*) FILTER (WHERE open_month = $1 AND received_date::date <= $4::date)::int AS mtd_count,
             COUNT(*) FILTER (WHERE open_month = $2)::int AS prior_count,
             COUNT(*) FILTER (WHERE open_month = $3)::int AS prior2_count
      FROM open_orders
      WHERE open_month IN ($1, $2, $3)
        AND LOWER(order_type) IN ('title & escrow', 'escrow only')
        AND file_number NOT ILIKE 'test%'
        AND file_number NOT ILIKE 'ar test%'
        AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)
      GROUP BY COALESCE(NULLIF(TRIM(escrow_officer), ''), '(Unassigned)'), ${bucketSql}
    `, [currentMonth, priorMonth, prior2Month, reportDate]),
    pool.query(`
      SELECT COALESCE(NULLIF(TRIM(escrow_officer), ''), '(Unassigned)') AS name,
             ${bucketSql} AS bucket,
             COUNT(*) FILTER (WHERE transaction_date::date = $4::date)::int AS day_count,
             COUNT(*) FILTER (WHERE fetch_month = $1 AND transaction_date::date <= $4::date)::int AS mtd_count,
             COUNT(*) FILTER (WHERE fetch_month = $2)::int AS prior_count,
             COUNT(*) FILTER (WHERE fetch_month = $3)::int AS prior2_count,
             ROUND(SUM(CASE WHEN transaction_date::date = $4::date THEN COALESCE(escrow_revenue, 0) ELSE 0 END)::numeric, 2) AS day_revenue,
             ROUND(SUM(CASE WHEN fetch_month = $1 AND transaction_date::date <= $4::date THEN COALESCE(escrow_revenue, 0) ELSE 0 END)::numeric, 2) AS mtd_revenue,
             ROUND(SUM(CASE WHEN fetch_month = $2 THEN COALESCE(escrow_revenue, 0) ELSE 0 END)::numeric, 2) AS prior_revenue,
             ROUND(SUM(CASE WHEN fetch_month = $3 THEN COALESCE(escrow_revenue, 0) ELSE 0 END)::numeric, 2) AS prior2_revenue
      FROM order_summary
      WHERE fetch_month IN ($1, $2, $3)
        AND transaction_date IS NOT NULL
        AND COALESCE(escrow_revenue, 0) > 0
      GROUP BY COALESCE(NULLIF(TRIM(escrow_officer), ''), '(Unassigned)'), ${bucketSql}
    `, [currentMonth, priorMonth, prior2Month, reportDate]),
  ]);

  const entities = {};
  for (const row of openResult.rows) {
    const entry = ensureEntity(entities, row.name)[row.bucket];
    entry.openings.day = num(row.day_count);
    entry.openings.mtd = num(row.mtd_count);
    entry.openings.prior = num(row.prior_count);
    entry.openings.prior2 = num(row.prior2_count);
  }
  for (const row of closeResult.rows) {
    const entry = ensureEntity(entities, row.name)[row.bucket];
    entry.closings.day = num(row.day_count);
    entry.closings.mtd = num(row.mtd_count);
    entry.closings.prior = num(row.prior_count);
    entry.closings.prior2 = num(row.prior2_count);
    entry.revenue.day = num(row.day_revenue);
    entry.revenue.mtd = num(row.mtd_revenue);
    entry.revenue.prior = num(row.prior_revenue);
    entry.revenue.prior2 = num(row.prior2_revenue);
  }
  return entities;
}

async function loadHistory(startMonth, endMonth) {
  if (endMonth < startMonth) return { months: [], values: {} };
  const branchClose = BRANCH_SQL('file_number');
  const branchOpen = BRANCH_SQL('file_number');
  const [closeResult, openResult] = await Promise.all([
    pool.query(`
      SELECT fetch_month AS month, ${branchClose} AS branch,
             (
               COUNT(*) FILTER (WHERE COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) > 0)
               + COUNT(*) FILTER (WHERE COALESCE(escrow_revenue, 0) > 0)
               + COUNT(*) FILTER (WHERE COALESCE(tsg_revenue, 0) > 0)
             )::int AS closes,
             ROUND(SUM(
               COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0)
               + COALESCE(escrow_revenue, 0) + COALESCE(tsg_revenue, 0)
             )::numeric, 2) AS revenue
      FROM order_summary
      WHERE fetch_month BETWEEN $1 AND $2 AND transaction_date IS NOT NULL
      GROUP BY fetch_month, ${branchClose}
      ORDER BY fetch_month, branch
    `, [startMonth, endMonth]),
    pool.query(`
      SELECT open_month AS month, ${branchOpen} AS branch,
             SUM(CASE
               WHEN LOWER(order_type) = 'title & escrow' THEN 2
               WHEN LOWER(order_type) IN ('title only', 'escrow only', 'trustee sale guarantee') THEN 1
               ELSE 0 END
             )::int AS opens
      FROM open_orders
      WHERE open_month BETWEEN $1 AND $2
        AND file_number NOT ILIKE 'test%'
        AND file_number NOT ILIKE 'ar test%'
        AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)
      GROUP BY open_month, ${branchOpen}
      ORDER BY open_month, branch
    `, [startMonth, endMonth]),
  ]);
  const months = monthSequence(startMonth, endMonth);
  const values = Object.fromEntries(months.map((month) => [month, {}]));
  const ensure = (month, branch) => {
    if (!values[month]) values[month] = {};
    if (!values[month][branch]) values[month][branch] = { opens: 0, closes: 0, revenue: 0 };
    return values[month][branch];
  };
  for (const row of closeResult.rows) {
    const entry = ensure(row.month, row.branch);
    entry.closes = num(row.closes);
    entry.revenue = num(row.revenue);
  }
  for (const row of openResult.rows) ensure(row.month, row.branch).opens = num(row.opens);
  for (const month of months) {
    const total = { opens: 0, closes: 0, revenue: 0 };
    for (const entry of Object.values(values[month])) {
      total.opens += entry.opens;
      total.closes += entry.closes;
      total.revenue += entry.revenue;
    }
    values[month]['Total Company'] = total;
  }
  return { months, values };
}

function sumReportEntries(entityMap, fields) {
  const result = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const entry of Object.values(entityMap || {})) {
    for (const field of fields) result[field] += num(entry[field]);
  }
  return result;
}

function makePriorComponent(title, titlePrevious, escrow, escrowOpen, escrowPrevious, escrowOpenPrevious, tsg, tsgOpen, tsgPrevious, tsgOpenPrevious) {
  const sumBranches = (report, fields) => {
    const total = Object.fromEntries(fields.map((field) => [field, 0]));
    for (const entityMap of Object.values(report || {})) {
      const branch = sumReportEntries(entityMap, fields);
      for (const field of fields) total[field] += branch[field];
    }
    return total;
  };
  return {
    title(branch, category) {
      const current = title.report?.[branch]?.[category] || {};
      const previous = titlePrevious.report?.[branch]?.[category] || {};
      return {
        opensPrior: num(current.prior_open), closesPrior: num(current.prior_closed),
        revenuePrior: num(current.prior_rev), opensPrior2: num(previous.prior_open),
        revenuePrior2: num(previous.prior_rev),
      };
    },
    titleAll(category) {
      const current = { prior_open: 0, prior_closed: 0, prior_rev: 0 };
      const previous = { prior_open: 0, prior_rev: 0 };
      for (const branch of Object.values(title.report || {})) {
        const entry = branch[category] || {};
        current.prior_open += num(entry.prior_open);
        current.prior_closed += num(entry.prior_closed);
        current.prior_rev += num(entry.prior_rev);
      }
      for (const branch of Object.values(titlePrevious.report || {})) {
        const entry = branch[category] || {};
        previous.prior_open += num(entry.prior_open);
        previous.prior_rev += num(entry.prior_rev);
      }
      return {
        opensPrior: current.prior_open, closesPrior: current.prior_closed,
        revenuePrior: current.prior_rev, opensPrior2: previous.prior_open,
        revenuePrior2: previous.prior_rev,
      };
    },
    escrow(branch) {
      const close = sumReportEntries(escrow.report?.[branch], ['prior_cnt', 'prior_rev']);
      const open = sumReportEntries(escrowOpen.report?.[branch], ['prior_cnt']);
      const close2 = sumReportEntries(escrowPrevious.report?.[branch], ['prior_cnt', 'prior_rev']);
      const open2 = sumReportEntries(escrowOpenPrevious.report?.[branch], ['prior_cnt']);
      return {
        opensPrior: open.prior_cnt, closesPrior: close.prior_cnt, revenuePrior: close.prior_rev,
        opensPrior2: open2.prior_cnt, revenuePrior2: close2.prior_rev,
      };
    },
    escrowAll() {
      const close = sumBranches(escrow.report, ['prior_cnt', 'prior_rev']);
      const open = sumBranches(escrowOpen.report, ['prior_cnt']);
      const close2 = sumBranches(escrowPrevious.report, ['prior_cnt', 'prior_rev']);
      const open2 = sumBranches(escrowOpenPrevious.report, ['prior_cnt']);
      return {
        opensPrior: open.prior_cnt, closesPrior: close.prior_cnt, revenuePrior: close.prior_rev,
        opensPrior2: open2.prior_cnt, revenuePrior2: close2.prior_rev,
      };
    },
    tsgAll() {
      const close = sumBranches(tsg.report, ['prior_cnt', 'prior_rev']);
      const open = sumBranches(tsgOpen.report, ['prior_cnt']);
      const close2 = sumBranches(tsgPrevious.report, ['prior_cnt', 'prior_rev']);
      const open2 = sumBranches(tsgOpenPrevious.report, ['prior_cnt']);
      return {
        opensPrior: open.prior_cnt, closesPrior: close.prior_cnt, revenuePrior: close.prior_rev,
        opensPrior2: open2.prior_cnt, revenuePrior2: close2.prior_rev,
      };
    },
  };
}

function addPrior(...items) {
  return items.reduce((total, item) => ({
    opensPrior: total.opensPrior + num(item.opensPrior),
    closesPrior: total.closesPrior + num(item.closesPrior),
    revenuePrior: total.revenuePrior + num(item.revenuePrior),
    opensPrior2: total.opensPrior2 + num(item.opensPrior2),
    revenuePrior2: total.revenuePrior2 + num(item.revenuePrior2),
  }), { opensPrior: 0, closesPrior: 0, revenuePrior: 0, opensPrior2: 0, revenuePrior2: 0 });
}

async function collectDailyExcelData(asOfDate) {
  const asOf = asOfDate || pacificDateString();
  const asOfParsed = parseDateOnly(asOf);
  const reportDate = shiftDate(asOf, -1);
  const currentMonth = reportDate.slice(0, 7);
  const priorMonth = shiftMonth(currentMonth, -1);
  const prior2Month = shiftMonth(currentMonth, -2);
  const { year, month } = monthParts(currentMonth);
  const priorParts = monthParts(priorMonth);
  const workedDays = countWorkingDays(`${currentMonth}-01`, reportDate);
  const totalWorkingDays = countWorkingDays(`${currentMonth}-01`, monthEnd(currentMonth));

  const [
    repMetrics, officerMetrics, history,
    title, titlePrevious,
    escrow, escrowOpen, escrowPrevious, escrowOpenPrevious,
    tsg, tsgOpen, tsgPrevious, tsgOpenPrevious,
    r14Report, escrowOfficerReport, reconciliation, companyPriorResult,
  ] = await Promise.all([
    loadRepMetrics({ currentMonth, priorMonth, prior2Month, reportDate }),
    loadEscrowOfficerMetrics({ currentMonth, priorMonth, prior2Month, reportDate }),
    loadHistory('2025-03', priorMonth),
    reports.dailyRevenue(month, year),
    reports.dailyRevenue(priorParts.month, priorParts.year),
    reports.escrowProduction(month, year),
    reports.escrowProductionOpenings(month, year),
    reports.escrowProduction(priorParts.month, priorParts.year),
    reports.escrowProductionOpenings(priorParts.month, priorParts.year),
    reports.tsgProduction(month, year),
    reports.tsgProductionOpenings(month, year),
    reports.tsgProduction(priorParts.month, priorParts.year),
    reports.tsgProductionOpenings(priorParts.month, priorParts.year),
    reports.r14Branches(month, year),
    reports.escrowOfficerProduction(month, year),
    pool.query(`
      SELECT ROUND(SUM(COALESCE(total_revenue, 0))::numeric, 2) AS grand_total
      FROM order_summary
      WHERE fetch_month = $1 AND transaction_date::date <= $2::date
    `, [currentMonth, reportDate]),
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM open_orders
         WHERE open_month = $1
           AND file_number NOT ILIKE 'test%' AND file_number NOT ILIKE 'ar test%'
           AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)) AS prior_open,
        (SELECT COUNT(*)::int FROM order_summary
         WHERE fetch_month = $1 AND transaction_date IS NOT NULL
           AND category IN ('Purchase', 'Refinance', 'Escrow', 'TSG')) AS prior_close,
        (SELECT ROUND(SUM(COALESCE(total_revenue, 0))::numeric, 2) FROM order_summary
         WHERE fetch_month = $1 AND transaction_date IS NOT NULL) AS prior_revenue,
        (SELECT COUNT(*)::int FROM open_orders
         WHERE open_month = $2
           AND file_number NOT ILIKE 'test%' AND file_number NOT ILIKE 'ar test%'
           AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)) AS prior2_open,
        (SELECT ROUND(SUM(COALESCE(total_revenue, 0))::numeric, 2) FROM order_summary
         WHERE fetch_month = $2 AND transaction_date IS NOT NULL) AS prior2_revenue
    `, [priorMonth, prior2Month]),
  ]);

  const prior = makePriorComponent(
    title, titlePrevious, escrow, escrowOpen, escrowPrevious, escrowOpenPrevious,
    tsg, tsgOpen, tsgPrevious, tsgOpenPrevious
  );

  return {
    asOf,
    asOfParsed,
    reportDate,
    currentMonth,
    priorMonth,
    prior2Month,
    workedDays,
    totalWorkingDays,
    reps: repMetrics.entities,
    nullTransactionTypeCount: repMetrics.nullTransactionTypeCount,
    officers: officerMetrics,
    history,
    prior,
    reportPayloads: { title, escrow, tsg, r14Report, escrowOfficerReport },
    reconciliationGrandTotal: num(reconciliation.rows[0]?.grand_total),
    companyPrior: {
      opensPrior: num(companyPriorResult.rows[0]?.prior_open),
      closesPrior: num(companyPriorResult.rows[0]?.prior_close),
      revenuePrior: num(companyPriorResult.rows[0]?.prior_revenue),
      opensPrior2: num(companyPriorResult.rows[0]?.prior2_open),
      revenuePrior2: num(companyPriorResult.rows[0]?.prior2_revenue),
    },
  };
}

function countFormulas(workbook) {
  const counts = {};
  for (const sheet of workbook.worksheets) {
    let count = 0;
    sheet.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.formula !== undefined) count++;
    }));
    counts[sheet.name] = count;
  }
  return counts;
}

function formulaAddresses(workbook) {
  const addresses = new Set();
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.formula !== undefined) addresses.add(`${sheet.name}!${cell.address}`);
    }));
  }
  return addresses;
}

function findRefErrors(workbook) {
  const refs = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value;
      if ((cell.formula && /#REF!/i.test(cell.formula))
        || (typeof value === 'string' && /#REF!/i.test(value))
        || (value && typeof value === 'object' && /#REF!/i.test(String(value.result || '')))) {
        refs.push(`${sheet.name}!${cell.address}`);
      }
    }));
  }
  return refs;
}

function setFormulaResult(cell, result) {
  if (cell.formula === undefined) return;
  const value = cell.value || {};
  cell.value = { ...value, result: num(result) };
}

function setIfNotFormula(cell, value) {
  if (cell.formula === undefined) cell.value = value;
}

function bucketTotal(entity, metric, period) {
  return BUCKETS.reduce((sum, bucket) => sum + num(entity?.[bucket]?.[metric]?.[period]), 0);
}

function titleRevenueTotal(entity, period) {
  return BUCKETS.reduce((sum, bucket) => sum + num(entity?.[bucket]?.revenue?.[period]), 0);
}

function writeR14(workbook, data) {
  const sheet = workbook.getWorksheet('r14');
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(data.asOfParsed);
  sheet.getCell('C1').value = `         PCT Daily Report as of ${monthName}`;
  sheet.getCell('L1').value = data.asOfParsed.getUTCDate();
  sheet.getCell('M1').value = data.asOfParsed.getUTCFullYear();
  sheet.getCell('P1').value = data.workedDays;
  sheet.getCell('R1').value = data.totalWorkingDays;

  const slotByDataName = new Map();
  for (const row of R14_SLOT_ROWS) {
    const label = sheet.getCell(`B${row}`).text.trim();
    if (!label) continue;
    slotByDataName.set(R14_ALIASES[label] || label, row);
    for (const col of R14_INPUT_COLUMNS) setIfNotFormula(sheet.getCell(`${col}${row}`), 0);
  }

  const fallbackReps = [];
  const fallback = emptyEntity();
  const rowEntities = new Map();
  for (const [name, entity] of Object.entries(data.reps)) {
    if (!entityHasActivity(entity)) continue;
    const row = slotByDataName.get(name);
    if (!row) {
      fallbackReps.push(name);
      addEntity(fallback, entity);
      continue;
    }
    rowEntities.set(row, entity);
  }

  // The legacy generic row keeps unmatched production in company totals while Notes names it explicitly.
  if (entityHasActivity(fallback)) {
    sheet.getCell('B44').value = 'Other County Reps';
    rowEntities.set(44, fallback);
  }

  const bucketCols = {
    Purchase: { od: 'E', om: 'J', cd: 'Q', cm: 'V', rd: 'AB', rm: 'AH' },
    Refinance: { od: 'F', om: 'K', cd: 'R', cm: 'W', rd: 'AC', rm: 'AI' },
    TSG: { od: 'G', om: 'L', cd: 'S', cm: 'X', rd: 'AD', rm: 'AJ' },
  };
  for (const [row, entity] of rowEntities) {
    for (const bucket of BUCKETS) {
      const cols = bucketCols[bucket];
      sheet.getCell(`${cols.od}${row}`).value = num(entity[bucket].openings.day);
      sheet.getCell(`${cols.om}${row}`).value = num(entity[bucket].openings.mtd);
      sheet.getCell(`${cols.cd}${row}`).value = num(entity[bucket].closings.day);
      sheet.getCell(`${cols.cm}${row}`).value = num(entity[bucket].closings.mtd);
      sheet.getCell(`${cols.rd}${row}`).value = roundMoney(entity[bucket].revenue.day);
      sheet.getCell(`${cols.rm}${row}`).value = roundMoney(entity[bucket].revenue.mtd);
    }
    sheet.getCell(`O${row}`).value = bucketTotal(entity, 'openings', 'prior');
    sheet.getCell(`Z${row}`).value = bucketTotal(entity, 'closings', 'prior');
    sheet.getCell(`AL${row}`).value = roundMoney(titleRevenueTotal(entity, 'prior'));
    sheet.getCell(`AM${row}`).value = roundMoney(titleRevenueTotal(entity, 'prior2'));
    const formulaResults = {
      H: bucketTotal(entity, 'openings', 'day'),
      M: bucketTotal(entity, 'openings', 'mtd'),
      N: data.workedDays ? bucketTotal(entity, 'openings', 'mtd') / data.workedDays * data.totalWorkingDays : 0,
      T: bucketTotal(entity, 'closings', 'day'),
      Y: bucketTotal(entity, 'closings', 'mtd'),
      AE: titleRevenueTotal(entity, 'day'),
      AK: titleRevenueTotal(entity, 'mtd'),
    };
    for (const [col, result] of Object.entries(formulaResults)) setFormulaResult(sheet.getCell(`${col}${row}`), result);
  }

  const sumRows = (rows, metric, period, bucket = null) => rows.reduce((sum, row) => {
    const entity = rowEntities.get(row);
    return sum + (bucket ? num(entity?.[bucket]?.[metric]?.[period]) : bucketTotal(entity, metric, period));
  }, 0);
  const glendaleRows = Array.from({ length: 37 }, (_, i) => i + 9);
  const orangeRows = Array.from({ length: 35 }, (_, i) => i + 49);
  const branchDefinitions = [
    { row: 46, rows: glendaleRows, subtract: {} },
    { row: 84, rows: orangeRows, subtract: { Purchase: [51], Refinance: [53], TSG: [53] } },
  ];
  const subtotalEntities = new Map();
  for (const definition of branchDefinitions) {
    const total = emptyEntity();
    for (const row of definition.rows) addEntity(total, rowEntities.get(row));
    for (const [bucket, rows] of Object.entries(definition.subtract)) {
      for (const row of rows) {
        const entity = rowEntities.get(row);
        if (!entity) continue;
        for (const metric of ['openings','closings','revenue']) {
          for (const period of ['day','mtd','prior','prior2']) {
            total[bucket][metric][period] -= num(entity[bucket][metric][period]);
          }
        }
      }
    }
    subtotalEntities.set(definition.row, total);
    const row = definition.row;
    for (const bucket of BUCKETS) {
      const cols = bucketCols[bucket];
      for (const [col, metric, period] of [
        [cols.od,'openings','day'],[cols.om,'openings','mtd'],[cols.cd,'closings','day'],
        [cols.cm,'closings','mtd'],[cols.rd,'revenue','day'],[cols.rm,'revenue','mtd'],
      ]) setFormulaResult(sheet.getCell(`${col}${row}`), total[bucket][metric][period]);
    }
    for (const [col, metric, period] of [
      ['H','openings','day'],['M','openings','mtd'],['T','closings','day'],['Y','closings','mtd'],
    ]) setFormulaResult(sheet.getCell(`${col}${row}`), bucketTotal(total, metric, period));
    setFormulaResult(sheet.getCell(`AE${row}`), titleRevenueTotal(total, 'day'));
    setFormulaResult(sheet.getCell(`AK${row}`), titleRevenueTotal(total, 'mtd'));
  }

  // Hidden/special legacy line feeding pro REO/HOA/Lien rows.
  const special = emptyEntity();
  const row51 = rowEntities.get(51) || emptyEntity();
  const row53 = rowEntities.get(53) || emptyEntity();
  const row64 = rowEntities.get(64) || emptyEntity();
  for (const metric of ['openings','closings','revenue']) {
    for (const period of ['day','mtd','prior','prior2']) {
      special.Purchase[metric][period] = num(row51.Purchase[metric][period]) + num(row51.Refinance[metric][period]);
      special.Refinance[metric][period] = num(row53.TSG[metric][period]);
      special.TSG[metric][period] = num(row64.TSG[metric][period]);
    }
  }
  const row106Cols = {
    Purchase: { od:'E',om:'J',cd:'Q',cm:'V',rd:'AB',rm:'AH' },
    Refinance: { od:'F',om:'K',cd:'R',cm:'W',rd:'AC',rm:'AI' },
    TSG: { od:'G',om:'L',cd:'S',cm:'X',rd:'AD',rm:'AJ' },
  };
  for (const bucket of BUCKETS) for (const [key, metric, period] of [
    ['od','openings','day'],['om','openings','mtd'],['cd','closings','day'],['cm','closings','mtd'],
    ['rd','revenue','day'],['rm','revenue','mtd'],
  ]) setFormulaResult(sheet.getCell(`${row106Cols[bucket][key]}106`), special[bucket][metric][period]);

  const company = emptyEntity();
  addEntity(company, subtotalEntities.get(46));
  addEntity(company, subtotalEntities.get(84));
  for (const bucket of BUCKETS) {
    const cols = bucketCols[bucket];
    for (const [col, metric, period] of [
      [cols.od,'openings','day'],[cols.om,'openings','mtd'],[cols.cd,'closings','day'],
      [cols.cm,'closings','mtd'],[cols.rd,'revenue','day'],[cols.rm,'revenue','mtd'],
    ]) setFormulaResult(sheet.getCell(`${col}104`), company[bucket][metric][period]);
  }
  for (const [col, metric, period] of [
    ['H','openings','day'],['M','openings','mtd'],['T','closings','day'],['Y','closings','mtd'],
  ]) setFormulaResult(sheet.getCell(`${col}104`), bucketTotal(company, metric, period));
  setFormulaResult(sheet.getCell('AE104'), titleRevenueTotal(company, 'day'));
  setFormulaResult(sheet.getCell('AK104'), titleRevenueTotal(company, 'mtd'));
  sheet.getCell('O104').value = bucketTotal(company, 'openings', 'prior');
  sheet.getCell('Z104').value = bucketTotal(company, 'closings', 'prior');
  sheet.getCell('AL104').value = roundMoney(titleRevenueTotal(company, 'prior'));
  sheet.getCell('AM104').value = roundMoney(titleRevenueTotal(company, 'prior2'));

  const unmatchedReps = fallbackReps.filter((name) => name !== 'Unassigned').sort();
  sheet.getCell('A105').value = fallbackReps.length
    ? `NOTES — Other County Reps includes: ${fallbackReps.sort().join(', ')}`
    : 'NOTES — unmatched reps: none';

  return {
    unmatchedReps,
    fallbackReps: fallbackReps.sort(),
    company,
    nullTransactionTypeCount: data.nullTransactionTypeCount,
    rowEntities,
    special,
  };
}

function writeEscrow(workbook, data) {
  const sheet = workbook.getWorksheet('Escrow');
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(data.asOfParsed);
  sheet.getCell('D1').value = `         PCT Daily Report as of ${monthName}`;
  sheet.getCell('H1').value = data.asOfParsed.getUTCDate();
  sheet.getCell('I1').value = data.asOfParsed.getUTCFullYear();
  sheet.getCell('K1').value = data.workedDays;
  sheet.getCell('M1').value = data.totalWorkingDays;

  const matched = new Set();
  const writeOfficerRows = (entity, saleRow, refiRow) => {
    const rows = { Purchase: saleRow, Refinance: refiRow };
    for (const bucket of ['Purchase','Refinance']) {
      const row = rows[bucket];
      const entry = entity[bucket];
      sheet.getCell(`D${row}`).value = num(entry.openings.day);
      sheet.getCell(`E${row}`).value = num(entry.openings.mtd);
      sheet.getCell(`F${row}`).value = num(entry.openings.prior);
      sheet.getCell(`H${row}`).value = num(entry.closings.day);
      sheet.getCell(`I${row}`).value = num(entry.closings.mtd);
      sheet.getCell(`J${row}`).value = num(entry.closings.prior);
      sheet.getCell(`L${row}`).value = roundMoney(entry.revenue.day);
      sheet.getCell(`M${row}`).value = roundMoney(entry.revenue.mtd);
      sheet.getCell(`N${row}`).value = roundMoney(entry.revenue.prior);
      sheet.getCell(`O${row}`).value = roundMoney(entry.revenue.prior2);
    }
  };
  for (const slot of ESCROW_SLOTS) {
    const entity = data.officers[slot.name] || emptyEntity();
    if (entityHasActivity(entity)) matched.add(slot.name);
    writeOfficerRows(entity, slot.sale, slot.refi);
    for (const [col, metric, period] of [
      ['D','openings','day'],['E','openings','mtd'],['F','openings','prior'],
      ['H','closings','day'],['I','closings','mtd'],['J','closings','prior'],
      ['L','revenue','day'],['M','revenue','mtd'],['N','revenue','prior'],
    ]) setFormulaResult(sheet.getCell(`${col}${slot.total}`),
      num(entity.Purchase[metric][period]) + num(entity.Refinance[metric][period]));
    sheet.getCell(`O${slot.total}`).value = roundMoney(
      entity.Purchase.revenue.prior2 + entity.Refinance.revenue.prior2
    );
  }
  const other = data.officers['(Unassigned)'] || emptyEntity();
  if (entityHasActivity(other)) matched.add('(Unassigned)');
  writeOfficerRows(other, 75, 76);

  const unmatchedOfficers = Object.entries(data.officers)
    .filter(([name, entity]) => entityHasActivity(entity) && !matched.has(name))
    .map(([name]) => name)
    .sort();

  const sumOfficers = (names) => names.reduce((total, name) => addEntity(total, data.officers[name]), emptyEntity());
  const glendale = sumOfficers(['Joseph Gomez','Lupe Vidaca']);
  const orange = sumOfficers(['Christine Quintanar','Analleli Ayala']);
  const porterville = sumOfficers(['Anna Ballesteros']);
  const inland = sumOfficers(['Karla Casco','(Unassigned)']);
  const company = sumOfficers([...ESCROW_SLOTS.map((slot) => slot.name), '(Unassigned)']);
  const totalRows = new Map([[48,glendale],[63,orange],[69,porterville],[77,inland],[78,inland],[79,company]]);
  for (const [row, entity] of totalRows) {
    for (const [col, metric, period] of [
      ['D','openings','day'],['E','openings','mtd'],['F','openings','prior'],
      ['H','closings','day'],['I','closings','mtd'],['J','closings','prior'],
      ['L','revenue','day'],['M','revenue','mtd'],['N','revenue','prior'],
    ]) setFormulaResult(sheet.getCell(`${col}${row}`), bucketTotal(entity, metric, period));
    setIfNotFormula(sheet.getCell(`O${row}`), roundMoney(titleRevenueTotal(entity, 'prior2')));
  }
  sheet.getCell('A82').value = unmatchedOfficers.length
    ? `NOTES — unmatched escrow officers (not included): ${unmatchedOfficers.join(', ')}`
    : `NOTES — unmatched escrow officers: none. (Unassigned) files included in Other.`;
  return { unmatchedOfficers, company, groupTotals: { glendale, orange, porterville, inland } };
}

function component(entity, bucket) {
  const source = entity?.[bucket] || emptyBucket();
  return {
    openings: { day: num(source.openings.day), mtd: num(source.openings.mtd) },
    closings: { day: num(source.closings.day), mtd: num(source.closings.mtd) },
    revenue: { day: num(source.revenue.day), mtd: num(source.revenue.mtd) },
  };
}

function addCurrent(...items) {
  return items.reduce((total, item) => {
    for (const metric of ['openings','closings','revenue']) {
      for (const period of ['day','mtd']) total[metric][period] += num(item?.[metric]?.[period]);
    }
    return total;
  }, { openings:{day:0,mtd:0}, closings:{day:0,mtd:0}, revenue:{day:0,mtd:0} });
}

function priorFromEntity(entity, bucket = null) {
  const buckets = bucket ? [bucket] : BUCKETS;
  const total = { opensPrior:0, closesPrior:0, revenuePrior:0, opensPrior2:0, revenuePrior2:0 };
  for (const name of buckets) {
    total.opensPrior += num(entity?.[name]?.openings?.prior);
    total.closesPrior += num(entity?.[name]?.closings?.prior);
    total.revenuePrior += num(entity?.[name]?.revenue?.prior);
    total.opensPrior2 += num(entity?.[name]?.openings?.prior2);
    total.revenuePrior2 += num(entity?.[name]?.revenue?.prior2);
  }
  return total;
}

function writeCurrentFormulaRow(sheet, row, value, workedDays, totalWorkingDays) {
  const results = {
    E: value.openings.day,
    F: value.openings.mtd,
    G: workedDays ? value.openings.mtd / workedDays : 0,
    H: workedDays ? value.openings.mtd / workedDays * totalWorkingDays : 0,
    K: value.closings.day,
    L: value.closings.mtd,
    M: workedDays ? value.closings.mtd / workedDays : 0,
    N: workedDays ? value.closings.mtd / workedDays * totalWorkingDays : 0,
    Q: value.revenue.day,
    R: value.revenue.mtd,
    S: workedDays ? value.revenue.mtd / workedDays * totalWorkingDays : 0,
  };
  for (const [col, result] of Object.entries(results)) setFormulaResult(sheet.getCell(`${col}${row}`), result);
}

function writePriorRow(sheet, row, prior) {
  sheet.getCell(`I${row}`).value = num(prior.opensPrior);
  sheet.getCell(`O${row}`).value = num(prior.closesPrior);
  sheet.getCell(`T${row}`).value = roundMoney(prior.revenuePrior);
  sheet.getCell(`U${row}`).value = roundMoney(prior.revenuePrior2);
  sheet.getCell(`AB${row}`).value = num(prior.opensPrior2);
}

function writeHistory(sheet, data) {
  const groupByMonth = new Map();
  for (let col = 29; col <= sheet.columnCount; col++) {
    const value = sheet.getCell(3, col).value;
    if (!(value instanceof Date)) continue;
    const month = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!groupByMonth.has(month)) groupByMonth.set(month, col);
  }
  const missingMonths = [];
  for (const month of data.history.months) {
    const col = groupByMonth.get(month);
    if (!col) {
      missingMonths.push(month);
      continue;
    }
    for (const [branch, row] of Object.entries(HISTORY_ROWS)) {
      const values = data.history.values[month]?.[branch] || { opens: 0, closes: 0, revenue: 0 };
      for (const [offset, metric] of [[0,'opens'],[1,'closes'],[2,'revenue']]) {
        const cell = sheet.getCell(row, col + offset);
        if (cell.formula === undefined) cell.value = metric === 'revenue' ? roundMoney(values[metric]) : num(values[metric]);
      }
    }
  }
  return { missingMonths, groupByMonth };
}

function writePro(workbook, data, r14State, escrowState) {
  const sheet = workbook.getWorksheet('pro');
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(data.asOfParsed);
  sheet.getCell('D1').value = `PCT Daily Report as of ${monthName}`;
  sheet.getCell('J1').value = data.asOfParsed.getUTCDate();
  sheet.getCell('K1').value = data.asOfParsed.getUTCFullYear();
  sheet.getCell('O1').value = data.workedDays;
  sheet.getCell('Q1').value = data.totalWorkingDays;

  const getR14Entity = (row) => {
    if (row === 106) return r14State.special;
    return row === 46
      ? [...r14State.rowEntities.entries()].filter(([r]) => r >= 9 && r <= 45).reduce((t,[,e])=>addEntity(t,e),emptyEntity())
      : row === 84
        ? (() => {
          const total = emptyEntity();
          for (const [r,e] of r14State.rowEntities) if (r >= 49 && r <= 83) addEntity(total,e);
          for (const [bucketName, subtractRows] of Object.entries({Purchase:[51],Refinance:[53],TSG:[53]})) {
            for (const subtractRow of subtractRows) {
              const e = r14State.rowEntities.get(subtractRow); if (!e) continue;
              for (const metric of ['openings','closings','revenue']) for (const period of ['day','mtd']) total[bucketName][metric][period] -= num(e[bucketName][metric][period]);
            }
          }
          return total;
        })()
        : emptyEntity();
  };
  const getR14 = (row, bucket) => component(getR14Entity(row), bucket);

  const glEscrowEntity = escrowState.groupTotals.glendale;
  const orEscrowEntity = escrowState.groupTotals.orange;
  const prvEscrowEntity = escrowState.groupTotals.porterville;
  const ieEscrowEntity = escrowState.groupTotals.inland;
  const glEscrow = addCurrent(component(glEscrowEntity,'Purchase'), component(glEscrowEntity,'Refinance'));
  const orEscrow = addCurrent(component(orEscrowEntity,'Purchase'), component(orEscrowEntity,'Refinance'));
  const prvEscrow = addCurrent(component(prvEscrowEntity,'Purchase'), component(prvEscrowEntity,'Refinance'));
  const ieEscrow = addCurrent(component(ieEscrowEntity,'Purchase'), component(ieEscrowEntity,'Refinance'));
  const glR14Entity = getR14Entity(46);
  const orR14Entity = getR14Entity(84);
  const glSale = getR14(46,'Purchase');
  const glRefi = getR14(46,'Refinance');
  const orSale = getR14(84,'Purchase');
  const orRefi = getR14(84,'Refinance');
  const reo = getR14(106,'Purchase');
  const hoa = getR14(106,'Refinance');
  const lien = getR14(106,'TSG');
  const titleTsg = getR14(84,'TSG');
  const tsgTotal = addCurrent(reo, hoa, lien, titleTsg);

  const currentRows = new Map([
    [17,glEscrow],[18,glSale],[19,glRefi],[20,addCurrent(glEscrow,glSale,glRefi)],
    [30,orEscrow],[31,orSale],[32,orRefi],[33,addCurrent(orEscrow,orSale,orRefi)],
    [35,reo],[36,hoa],[37,lien],[38,titleTsg],[39,tsgTotal],
    [41,prvEscrow],[44,ieEscrow],
  ]);
  const escrowTotal = addCurrent(glEscrow,orEscrow,prvEscrow,ieEscrow);
  const saleTotal = addCurrent(glSale,orSale,reo);
  const refiTotal = addCurrent(glRefi,orRefi);
  const southern = addCurrent(escrowTotal,saleTotal,refiTotal,tsgTotal);
  currentRows.set(47,escrowTotal);
  currentRows.set(48,saleTotal);
  currentRows.set(49,refiTotal);
  currentRows.set(50,tsgTotal);
  currentRows.set(51,southern);
  currentRows.set(53,southern);
  currentRows.set(57,southern);
  for (const [row, value] of currentRows) writeCurrentFormulaRow(sheet,row,value,data.workedDays,data.totalWorkingDays);

  const zeroPrior = { opensPrior:0,closesPrior:0,revenuePrior:0,opensPrior2:0,revenuePrior2:0 };
  const glEscrowP = priorFromEntity(glEscrowEntity);
  const glSaleP = priorFromEntity(glR14Entity,'Purchase');
  const glRefiP = priorFromEntity(glR14Entity,'Refinance');
  const orEscrowP = priorFromEntity(orEscrowEntity);
  const orSaleP = priorFromEntity(orR14Entity,'Purchase');
  const orRefiP = priorFromEntity(orR14Entity,'Refinance');
  const prvEscrowP = priorFromEntity(prvEscrowEntity);
  const ieEscrowP = priorFromEntity(ieEscrowEntity);
  const reoP = priorFromEntity(r14State.special,'Purchase');
  const hoaP = priorFromEntity(r14State.special,'Refinance');
  const lienP = priorFromEntity(r14State.special,'TSG');
  const titleTsgP = priorFromEntity(orR14Entity,'TSG');
  const tsgP = addPrior(reoP,hoaP,lienP,titleTsgP);
  const escrowP = priorFromEntity(escrowState.company);
  const saleP = addPrior(glSaleP,orSaleP,reoP);
  const refiP = addPrior(glRefiP,orRefiP);
  const companyP = addPrior(escrowP,saleP,refiP,tsgP);
  const priorRows = new Map([
    [17,glEscrowP],[18,glSaleP],[19,glRefiP],[20,addPrior(glEscrowP,glSaleP,glRefiP)],
    [30,orEscrowP],[31,orSaleP],[32,orRefiP],[33,addPrior(orEscrowP,orSaleP,orRefiP)],
    [35,reoP],[36,hoaP],[37,lienP],[38,titleTsgP],[39,tsgP],
    [41,prvEscrowP],[44,ieEscrowP],[47,escrowP],[48,saleP],[49,refiP],[50,tsgP],
    [51,companyP],[53,companyP],[57,companyP],
  ]);
  for (const [row, value] of priorRows) writePriorRow(sheet,row,value);
  for (const row of [51,53,57]) writePriorRow(sheet,row,data.companyPrior);
  for (const row of [56,59]) {
    for (const col of ['I','L','O','T','U','W','X','AB']) if (sheet.getCell(`${col}${row}`).formula === undefined) sheet.getCell(`${col}${row}`).value = 0;
  }
  // Current formula caches for the built-in math-check row.
  for (const col of ['E','F','G','H','K','M','N','Q','R','S']) setFormulaResult(sheet.getCell(`${col}56`), 0);

  const history = writeHistory(sheet, data);
  const companyDifference = roundMoney(southern.revenue.mtd - data.reconciliationGrandTotal);
  return { company: southern, companyPrior: companyP, companyDifference, history };
}

async function buildDailyExcel(asOfDate) {
  const data = await collectDailyExcelData(asOfDate);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(MASTER_PATH);
  const formulaCountsBefore = countFormulas(workbook);
  const formulaAddressesBefore = formulaAddresses(workbook);
  const r14State = writeR14(workbook, data);
  const escrowState = writeEscrow(workbook, data);
  const proState = writePro(workbook, data, r14State, escrowState);
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  workbook.calcProperties.calcMode = 'auto';
  workbook.creator = 'Pacific Coast Title';
  workbook.modified = new Date();

  const formulaCountsAfter = countFormulas(workbook);
  const formulaAddressesAfter = formulaAddresses(workbook);
  const refs = findRefErrors(workbook);
  if (JSON.stringify(formulaCountsBefore) !== JSON.stringify(formulaCountsAfter)) {
    const lost = [...formulaAddressesBefore].filter((address) => !formulaAddressesAfter.has(address));
    throw new Error(`formula count changed during fill: ${JSON.stringify({formulaCountsBefore,formulaCountsAfter,lost})}`);
  }
  if (refs.length) throw new Error(`workbook contains #REF!: ${refs.join(', ')}`);
  if (Math.abs(proState.companyDifference) > 0.01) {
    throw new Error(`pro company revenue does not reconcile: difference ${proState.companyDifference.toFixed(2)}`);
  }
  if (proState.history.missingMonths.length) {
    throw new Error(`history groups missing: ${proState.history.missingMonths.join(', ')}`);
  }

  const metadata = {
    asOf: data.asOf,
    reportDate: data.reportDate,
    nullTransactionTypeCount: data.nullTransactionTypeCount,
    unmatchedReps: r14State.unmatchedReps,
    fallbackReps: r14State.fallbackReps,
    unmatchedOfficers: escrowState.unmatchedOfficers,
    formulaCountsBefore,
    formulaCountsAfter,
    refErrors: refs,
    reconciliationGrandTotal: roundMoney(data.reconciliationGrandTotal),
    proCompanyRevenueMtd: roundMoney(proState.company.revenue.mtd),
    proDifference: proState.companyDifference,
    r14Company: {
      openingsDay: bucketTotal(r14State.company,'openings','day'),
      openingsMtd: bucketTotal(r14State.company,'openings','mtd'),
      closingsDay: bucketTotal(r14State.company,'closings','day'),
      closingsMtd: bucketTotal(r14State.company,'closings','mtd'),
      titleTsgRevenueDay: roundMoney(titleRevenueTotal(r14State.company,'day')),
      titleTsgRevenueMtd: roundMoney(titleRevenueTotal(r14State.company,'mtd')),
    },
    escrowCompany: {
      openingsDay: bucketTotal(escrowState.company,'openings','day'),
      openingsMtd: bucketTotal(escrowState.company,'openings','mtd'),
      closingsDay: bucketTotal(escrowState.company,'closings','day'),
      closingsMtd: bucketTotal(escrowState.company,'closings','mtd'),
      revenueDay: roundMoney(titleRevenueTotal(escrowState.company,'day')),
      revenueMtd: roundMoney(titleRevenueTotal(escrowState.company,'mtd')),
    },
  };
  const output = Buffer.from(await workbook.xlsx.writeBuffer());
  Object.defineProperty(output, 'dailyExcelMetadata', { value: metadata, enumerable: false });
  return output;
}

async function sendDailyExcelTest(testEmail = TEST_EMAIL) {
  if (testEmail !== TEST_EMAIL) throw new Error(`test delivery is restricted to ${TEST_EMAIL}`);
  if (!process.env.SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not set');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const asOf = pacificDateString();
  const buffer = await buildDailyExcel(asOf);
  const filename = `PCT_Daily_Report_${asOf}.xlsx`;
  await sgMail.send({
    to: TEST_EMAIL,
    from: process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com',
    subject: `[TEST] PCT Daily Excel — ${asOf}`,
    html: '<div style="background:#fef3c7;color:#92400e;padding:12px 20px;text-align:center;font-family:Arial,sans-serif;font-weight:700;">TEST ONLY — Tom and Al did not receive this email</div><p style="font-family:Arial,sans-serif;">Attached is the dashboard-filled legacy daily workbook.</p>',
    attachments: [{ content: buffer.toString('base64'), filename, type: EXCEL_MIME, disposition: 'attachment' }],
  });
  return { sent: true, sentTo: TEST_EMAIL, filename, bytes: buffer.length, metadata: buffer.dailyExcelMetadata };
}

module.exports = {
  buildDailyExcel,
  collectDailyExcelData,
  sendDailyExcelTest,
  pacificDateString,
  EXCEL_MIME,
  MASTER_PATH,
};
