const ExcelJS = require('exceljs');
const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');
const reports = require('./reports');

const LIVE_BRANCHES = ['Glendale', 'Orange', 'Inland Empire', 'Porterville', 'TSG'];
const R14_CATEGORIES = ['Purchase', 'Refinance', 'Escrow', 'TSG'];
const CATEGORY_LABELS = {
  Purchase: 'Title Sales',
  Refinance: 'Title Refi',
  Escrow: 'Escrow',
  TSG: 'Title TSG',
};
const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TEST_EMAIL = process.env.DAILY_EXCEL_TEST_EMAIL || 'ghernandez@pct.com';
const BLUE = 'FF03374F';
const ORANGE = 'FFF26B2B';
const LIGHT_BLUE = 'FFDCEAF1';
const LIGHT_GRAY = 'FFF1F3F5';
const WHITE = 'FFFFFFFF';

function num(value) {
  return Number.parseFloat(value) || 0;
}

function pacificDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error('date must use YYYY-MM-DD');
  }
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

function monthBefore(yearMonth) {
  const parsed = new Date(`${yearMonth}-01T12:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() - 1);
  return parsed.toISOString().slice(0, 7);
}

function monthLabel(yearMonth) {
  const parsed = new Date(`${yearMonth}-01T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function longDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(value));
}

function monthSequence(startMonth, endMonth) {
  const result = [];
  const cursor = new Date(`${startMonth}-01T12:00:00Z`);
  const end = new Date(`${endMonth}-01T12:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function emptyComponent() {
  return {
    openings: { day: 0, mtd: 0, prior: 0, avg: 0, proj: 0 },
    closings: { day: 0, mtd: 0, prior: 0, avg: 0, proj: 0 },
    revenue: { day: 0, mtd: 0, prior: 0, proj: 0 },
  };
}

function finishComponent(component, workedDays, totalWorkingDays) {
  component.openings.avg = workedDays ? component.openings.mtd / workedDays : 0;
  component.openings.proj = component.openings.avg * totalWorkingDays;
  component.closings.avg = workedDays ? component.closings.mtd / workedDays : 0;
  component.closings.proj = component.closings.avg * totalWorkingDays;
  component.revenue.proj = workedDays
    ? (component.revenue.mtd / workedDays) * totalWorkingDays
    : 0;
  return component;
}

function addComponent(target, source) {
  for (const period of ['day', 'mtd', 'prior']) {
    target.openings[period] += source.openings[period];
    target.closings[period] += source.closings[period];
    target.revenue[period] += source.revenue[period];
  }
  return target;
}

function hasComponentActivity(component) {
  return ['openings', 'closings', 'revenue'].some((group) =>
    ['day', 'mtd', 'prior'].some((period) => Math.abs(component[group][period] || 0) > 0.0001)
  );
}

function closeEntryToComponent(entry) {
  const component = emptyComponent();
  if (!entry) return component;
  component.closings.day = num(entry.today_closed ?? entry.today_cnt);
  component.closings.mtd = num(entry.mtd_closed ?? entry.mtd_cnt);
  component.closings.prior = num(entry.prior_closed ?? entry.prior_cnt);
  component.revenue.day = num(entry.today_rev);
  component.revenue.mtd = num(entry.mtd_rev);
  component.revenue.prior = num(entry.prior_rev);
  return component;
}

function applyOpenEntry(component, entry) {
  if (!entry) return component;
  component.openings.day = num(entry.today_open ?? entry.today_cnt);
  component.openings.mtd = num(entry.mtd_open ?? entry.mtd_cnt);
  component.openings.prior = num(entry.prior_open ?? entry.prior_cnt);
  return component;
}

function sumEntityEntries(entityMap) {
  const component = emptyComponent();
  for (const entry of Object.values(entityMap || {})) {
    addComponent(component, closeEntryToComponent(entry));
  }
  return component;
}

function sumOpenEntries(entityMap) {
  const component = emptyComponent();
  component.openings.day = Object.values(entityMap || {})
    .reduce((sum, entry) => sum + num(entry.today_cnt), 0);
  component.openings.mtd = Object.values(entityMap || {})
    .reduce((sum, entry) => sum + num(entry.mtd_cnt), 0);
  component.openings.prior = Object.values(entityMap || {})
    .reduce((sum, entry) => sum + num(entry.prior_cnt), 0);
  return component;
}

function branchFromFileSql(columnName) {
  return `CASE
    WHEN ${columnName} LIKE '%-GLT' THEN 'Glendale'
    WHEN ${columnName} LIKE '%-OCT' THEN 'Orange'
    WHEN ${columnName} LIKE '%-ONT' THEN 'Inland Empire'
    WHEN ${columnName} LIKE '%-PRV' THEN 'Porterville'
    WHEN ${columnName} LIKE '%-TSG' OR ${columnName} LIKE '99%' THEN 'TSG'
    ELSE 'Unassigned'
  END`;
}

async function loadHistory(startMonth, endMonth) {
  if (endMonth < startMonth) return { months: [], values: {} };
  const suffixClose = branchFromFileSql('os.file_number');
  const suffixOpen = branchFromFileSql('oo.file_number');
  const [closeResult, openResult] = await Promise.all([
    pool.query(`
      SELECT month, branch,
             SUM(closes)::int AS closes,
             ROUND(SUM(revenue)::numeric, 2) AS revenue
      FROM (
        SELECT os.fetch_month AS month,
               COALESCE(tob.branch, 'Unassigned') AS branch,
               COUNT(*) FILTER (
                 WHERE COALESCE(os.title_revenue, 0) + COALESCE(os.underwriter_revenue, 0) > 0
               ) AS closes,
               SUM(COALESCE(os.title_revenue, 0) + COALESCE(os.underwriter_revenue, 0)) AS revenue
        FROM order_summary os
        LEFT JOIN title_officer_branches tob
          ON tob.officer_name = os.title_officer AND tob.is_active = true
        WHERE os.fetch_month BETWEEN $1 AND $2
        GROUP BY os.fetch_month, COALESCE(tob.branch, 'Unassigned')

        UNION ALL

        SELECT os.fetch_month AS month, ${suffixClose} AS branch,
               COUNT(*) AS closes, SUM(COALESCE(os.escrow_revenue, 0)) AS revenue
        FROM order_summary os
        WHERE os.fetch_month BETWEEN $1 AND $2
          AND COALESCE(os.escrow_revenue, 0) > 0
        GROUP BY os.fetch_month, ${suffixClose}

        UNION ALL

        SELECT os.fetch_month AS month,
               COALESCE(tob.branch, 'Unassigned') AS branch,
               COUNT(*) AS closes, SUM(COALESCE(os.total_revenue, 0)) AS revenue
        FROM order_summary os
        LEFT JOIN title_officer_branches tob
          ON tob.officer_name = os.title_officer AND tob.is_active = true
        WHERE os.fetch_month BETWEEN $1 AND $2 AND os.category = 'TSG'
        GROUP BY os.fetch_month, COALESCE(tob.branch, 'Unassigned')
      ) parts
      GROUP BY month, branch
      ORDER BY month, branch
    `, [startMonth, endMonth]),
    pool.query(`
      SELECT month, branch, SUM(opens)::int AS opens
      FROM (
        SELECT oo.open_month AS month,
               COALESCE(tob.branch, 'Unassigned') AS branch,
               COUNT(*) AS opens
        FROM open_orders oo
        LEFT JOIN title_officer_branches tob
          ON tob.officer_name = oo.title_officer AND tob.is_active = true
        WHERE oo.open_month BETWEEN $1 AND $2
          AND LOWER(oo.order_type) IN ('title only', 'title & escrow')
          AND oo.file_number NOT ILIKE 'test%'
          AND oo.file_number NOT ILIKE 'ar test%'
          AND (oo.profile NOT ILIKE '%test & training%' OR oo.profile IS NULL)
        GROUP BY oo.open_month, COALESCE(tob.branch, 'Unassigned')

        UNION ALL

        SELECT oo.open_month AS month, ${suffixOpen} AS branch, COUNT(*) AS opens
        FROM open_orders oo
        WHERE oo.open_month BETWEEN $1 AND $2
          AND LOWER(oo.order_type) IN ('title & escrow', 'escrow only')
          AND oo.file_number NOT ILIKE 'test%'
          AND oo.file_number NOT ILIKE 'ar test%'
          AND (oo.profile NOT ILIKE '%test & training%' OR oo.profile IS NULL)
        GROUP BY oo.open_month, ${suffixOpen}

        UNION ALL

        SELECT oo.open_month AS month, ${suffixOpen} AS branch, COUNT(*) AS opens
        FROM open_orders oo
        WHERE oo.open_month BETWEEN $1 AND $2
          AND LOWER(oo.order_type) = 'trustee sale guarantee'
          AND oo.file_number NOT ILIKE 'test%'
          AND oo.file_number NOT ILIKE 'ar test%'
          AND (oo.profile NOT ILIKE '%test & training%' OR oo.profile IS NULL)
        GROUP BY oo.open_month, ${suffixOpen}
      ) parts
      GROUP BY month, branch
      ORDER BY month, branch
    `, [startMonth, endMonth]),
  ]);

  const months = monthSequence(startMonth, endMonth);
  const values = {};
  for (const month of months) values[month] = {};
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
  for (const row of openResult.rows) {
    ensure(row.month, row.branch).opens = num(row.opens);
  }
  for (const month of months) {
    const company = { opens: 0, closes: 0, revenue: 0 };
    for (const entry of Object.values(values[month])) {
      company.opens += entry.opens;
      company.closes += entry.closes;
      company.revenue += entry.revenue;
    }
    values[month]['Total Company'] = company;
  }
  return { months, values };
}

async function loadRepOpenBreakdown(currentMonth, priorMonth, reportDate) {
  const suffix = branchFromFileSql('file_number');
  const { rows } = await pool.query(`
    SELECT ${suffix} AS branch,
           COALESCE(NULLIF(TRIM(sales_rep), ''), 'Unassigned') AS sales_rep,
           category,
           COUNT(*) FILTER (WHERE open_month = $1)::int AS mtd_cnt,
           COUNT(*) FILTER (WHERE received_date::date = $3::date)::int AS today_cnt,
           COUNT(*) FILTER (WHERE open_month = $2)::int AS prior_cnt
    FROM open_orders
    WHERE open_month IN ($1, $2)
      AND category IN ('Purchase', 'Refinance', 'Escrow', 'TSG')
      AND file_number NOT ILIKE 'test%'
      AND file_number NOT ILIKE 'ar test%'
      AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)
    GROUP BY ${suffix}, COALESCE(NULLIF(TRIM(sales_rep), ''), 'Unassigned'), category
  `, [currentMonth, priorMonth, reportDate]);

  const result = {};
  for (const row of rows) {
    if (!result[row.branch]) result[row.branch] = {};
    if (!result[row.branch][row.sales_rep]) result[row.branch][row.sales_rep] = {};
    result[row.branch][row.sales_rep][row.category] = {
      day: num(row.today_cnt),
      mtd: num(row.mtd_cnt),
      prior: num(row.prior_cnt),
    };
  }
  return result;
}

function buildRepData(r14Close, openBreakdown, workedDays, totalWorkingDays) {
  const branchNames = new Set([
    ...Object.keys(r14Close.report || {}),
    ...Object.keys(openBreakdown || {}),
  ]);
  const orderedBranches = [
    ...LIVE_BRANCHES.filter((branch) => branchNames.has(branch)),
    ...[...branchNames].filter((branch) => !LIVE_BRANCHES.includes(branch)).sort(),
  ];
  const branches = [];
  const company = {
    openings: { day: {}, mtd: {} },
    closings: { day: {}, mtd: {} },
    revenue: { day: 0, mtd: 0, proj: 0 },
  };
  for (const period of ['day', 'mtd']) {
    for (const cat of R14_CATEGORIES) {
      company.openings[period][cat] = 0;
      company.closings[period][cat] = 0;
    }
  }

  for (const branch of orderedBranches) {
    const closeReps = r14Close.report?.[branch] || {};
    const openReps = openBreakdown?.[branch] || {};
    const repNames = new Set([...Object.keys(closeReps), ...Object.keys(openReps)]);
    const reps = [];
    for (const repName of [...repNames].sort((a, b) => a.localeCompare(b))) {
      const close = closeReps[repName] || {};
      const open = openReps[repName] || {};
      const row = {
        name: repName,
        openings: { day: {}, mtd: {} },
        closings: { day: {}, mtd: {} },
        revenue: {
          day: num(close.totals?.today_rev),
          mtd: num(close.totals?.mtd_rev),
          proj: 0,
        },
      };
      row.revenue.proj = workedDays ? (row.revenue.mtd / workedDays) * totalWorkingDays : 0;
      let active = Math.abs(row.revenue.day) > 0.0001 || Math.abs(row.revenue.mtd) > 0.0001;
      for (const period of ['day', 'mtd']) {
        for (const cat of R14_CATEGORIES) {
          row.openings[period][cat] = num(open[cat]?.[period]);
          row.closings[period][cat] = num(close[cat]?.[period === 'day' ? 'today_cnt' : 'mtd_cnt']);
          if (row.openings[period][cat] || row.closings[period][cat]) active = true;
        }
      }
      const hasPrior = R14_CATEGORIES.some((cat) =>
        num(open[cat]?.prior) > 0 || num(close[cat]?.prior_cnt) > 0
      );
      if (!active && !hasPrior) continue;
      reps.push(row);
    }

    if (!reps.length) continue;
    const subtotal = {
      openings: { day: {}, mtd: {} },
      closings: { day: {}, mtd: {} },
      revenue: { day: 0, mtd: 0, proj: 0 },
    };
    for (const period of ['day', 'mtd']) {
      for (const cat of R14_CATEGORIES) {
        subtotal.openings[period][cat] = reps.reduce(
          (sum, rep) => sum + rep.openings[period][cat], 0
        );
        subtotal.closings[period][cat] = reps.reduce(
          (sum, rep) => sum + rep.closings[period][cat], 0
        );
        company.openings[period][cat] += subtotal.openings[period][cat];
        company.closings[period][cat] += subtotal.closings[period][cat];
      }
    }
    for (const period of ['day', 'mtd', 'proj']) {
      subtotal.revenue[period] = reps.reduce((sum, rep) => sum + rep.revenue[period], 0);
      company.revenue[period] += subtotal.revenue[period];
    }
    branches.push({ name: branch, reps, subtotal });
  }
  return { branches, company };
}

async function collectDailyExcelData(asOfDate) {
  const asOf = asOfDate || pacificDateString();
  parseDateOnly(asOf);
  const reportDate = shiftDate(asOf, -1);
  const currentMonth = reportDate.slice(0, 7);
  const [year, month] = currentMonth.split('-').map(Number);
  const priorMonth = monthBefore(currentMonth);

  const [
    titleClose,
    titleOpen,
    escrowClose,
    escrowOpen,
    tsgClose,
    tsgOpen,
    r14Close,
    reconciliationResult,
    history,
    repOpenBreakdown,
  ] = await Promise.all([
    reports.dailyRevenue(month, year),
    reports.dailyRevenueOpenings(month, year),
    reports.escrowProduction(month, year),
    reports.escrowProductionOpenings(month, year),
    reports.tsgProduction(month, year),
    reports.tsgProductionOpenings(month, year),
    reports.r14Branches(month, year),
    pool.query(`
      SELECT ROUND(SUM(COALESCE(total_revenue, 0))::numeric, 2) AS grand_total
      FROM order_summary WHERE fetch_month = $1
    `, [currentMonth]),
    loadHistory('2025-03', priorMonth),
    loadRepOpenBreakdown(currentMonth, priorMonth, reportDate),
  ]);

  if (titleClose.dates.yesterday !== reportDate) {
    throw new Error(
      `POC date ${asOf} is outside the live dashboard day (${titleClose.dates.yesterday}); ` +
      'use today in Pacific time so the workbook remains an exact dashboard rendering'
    );
  }

  const workedDays = num(titleClose.dates.workedDays);
  const totalWorkingDays = num(titleClose.dates.totalWorkingDays);
  const allBranchNames = new Set(LIVE_BRANCHES);
  for (const source of [titleClose, titleOpen, escrowClose, escrowOpen, tsgClose, tsgOpen]) {
    Object.keys(source.report || {}).forEach((branch) => allBranchNames.add(branch));
  }
  const orderedBranches = [
    ...LIVE_BRANCHES,
    ...[...allBranchNames].filter((branch) => !LIVE_BRANCHES.includes(branch)).sort(),
  ];

  const branches = [];
  const company = emptyComponent();
  for (const branchName of orderedBranches) {
    const categories = {};
    for (const category of R14_CATEGORIES) {
      let component = emptyComponent();
      if (category === 'Purchase' || category === 'Refinance') {
        component = closeEntryToComponent(titleClose.report?.[branchName]?.[category]);
        applyOpenEntry(component, titleOpen.report?.[branchName]?.[category]);
      } else if (category === 'Escrow') {
        component = sumEntityEntries(escrowClose.report?.[branchName]);
        addComponent(component, sumOpenEntries(escrowOpen.report?.[branchName]));
      } else {
        component = sumEntityEntries(tsgClose.report?.[branchName]);
        addComponent(component, sumOpenEntries(tsgOpen.report?.[branchName]));
      }
      finishComponent(component, workedDays, totalWorkingDays);
      if (hasComponentActivity(component)) categories[category] = component;
    }
    if (!Object.keys(categories).length) continue;
    const totals = emptyComponent();
    Object.values(categories).forEach((component) => addComponent(totals, component));
    finishComponent(totals, workedDays, totalWorkingDays);
    addComponent(company, totals);
    branches.push({
      name: branchName,
      label: branchName === 'TSG' ? 'TSG — lien reports pending export' : branchName,
      categories,
      totals,
    });
  }
  finishComponent(company, workedDays, totalWorkingDays);

  const reconciliationGrandTotal = num(reconciliationResult.rows[0]?.grand_total);
  const difference = Math.round((company.revenue.mtd - reconciliationGrandTotal) * 100) / 100;
  const reps = buildRepData(r14Close, repOpenBreakdown, workedDays, totalWorkingDays);

  return {
    asOf,
    reportDate,
    currentMonth,
    priorMonth,
    workedDays,
    totalWorkingDays,
    branches,
    company,
    reconciliationGrandTotal,
    difference,
    history,
    reps,
  };
}

function setFill(cell, color) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function styleHeader(cell, color = BLUE) {
  setFill(cell, color);
  cell.font = { bold: true, color: { argb: WHITE } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: WHITE } },
    bottom: { style: 'thin', color: { argb: WHITE } },
    left: { style: 'thin', color: { argb: WHITE } },
    right: { style: 'thin', color: { argb: WHITE } },
  };
}

function styleTotalRow(row, color = LIGHT_BLUE) {
  row.font = { bold: true, color: { argb: BLUE } };
  row.eachCell((cell) => {
    setFill(cell, color);
    cell.border = { top: { style: 'thin', color: { argb: BLUE } } };
  });
}

function componentValues(component) {
  return [
    component.openings.day,
    component.openings.mtd,
    component.openings.avg,
    component.openings.proj,
    component.openings.prior,
    component.closings.day,
    component.closings.mtd,
    component.closings.avg,
    component.closings.proj,
    component.closings.prior,
    component.revenue.day,
    component.revenue.mtd,
    component.revenue.proj,
    component.revenue.prior,
  ];
}

function historyValues(data, branch) {
  const values = [];
  for (const month of data.history.months) {
    const entry = data.history.values[month]?.[branch] || { opens: 0, closes: 0, revenue: 0 };
    values.push(entry.opens, entry.closes, entry.revenue);
  }
  return values;
}

function configureDailySheet(sheet, data) {
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
  sheet.properties.defaultRowHeight = 18;
  sheet.getColumn(1).width = 34;
  for (let col = 2; col <= 15; col++) sheet.getColumn(col).width = 12;
  sheet.getColumn(16).width = 3;
  for (let col = 17; col < 17 + data.history.months.length * 3; col++) {
    sheet.getColumn(col).width = 13;
  }

  sheet.mergeCells(1, 1, 1, 8);
  sheet.getCell(1, 1).value = `PCT Daily Report as of ${longDate(data.asOf)}`;
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: BLUE } };
  sheet.mergeCells(1, 9, 1, 15);
  sheet.getCell(1, 9).value =
    `Day ${data.workedDays} of ${data.totalWorkingDays} working days`;
  sheet.getCell(1, 9).alignment = { horizontal: 'right' };
  sheet.getCell(1, 9).font = { bold: true, color: { argb: ORANGE } };

  sheet.getCell(3, 1).value = 'BRANCH / CATEGORY';
  sheet.mergeCells(3, 2, 3, 6);
  sheet.getCell(3, 2).value = 'OPENINGS';
  sheet.mergeCells(3, 7, 3, 11);
  sheet.getCell(3, 7).value = 'CLOSINGS';
  sheet.mergeCells(3, 12, 3, 15);
  sheet.getCell(3, 12).value = 'REVENUE';
  ['A3', 'B3', 'G3', 'L3'].forEach((ref) => styleHeader(sheet.getCell(ref)));

  const subheads = [
    'Branch / Category',
    'Day', 'Mnth', 'Avg', 'Proj', 'Prior',
    'Day', 'Mnth', 'Avg', 'Proj', 'Prior',
    'Day', 'Mnth', 'Proj', 'Prior',
  ];
  subheads.forEach((value, index) => {
    const cell = sheet.getCell(4, index + 1);
    cell.value = value;
    styleHeader(cell, ORANGE);
  });

  let historyCol = 17;
  for (const month of data.history.months) {
    sheet.mergeCells(3, historyCol, 3, historyCol + 2);
    sheet.getCell(3, historyCol).value = monthLabel(month);
    styleHeader(sheet.getCell(3, historyCol));
    for (let offset = 0; offset < 3; offset++) {
      const cell = sheet.getCell(4, historyCol + offset);
      cell.value = ['Opens', 'Closes', 'Revenue'][offset];
      styleHeader(cell, ORANGE);
    }
    historyCol += 3;
  }

  let rowNumber = 5;
  for (const branch of data.branches) {
    const branchRow = sheet.getRow(rowNumber++);
    branchRow.getCell(1).value = branch.label;
    branchRow.font = { bold: true, color: { argb: BLUE } };
    setFill(branchRow.getCell(1), LIGHT_GRAY);

    for (const category of R14_CATEGORIES) {
      const component = branch.categories[category];
      if (!component) continue;
      const row = sheet.getRow(rowNumber++);
      row.values = [`  ${CATEGORY_LABELS[category]}`, ...componentValues(component)];
    }

    const totalRow = sheet.getRow(rowNumber++);
    totalRow.values = [
      `${branch.name} Total`,
      ...componentValues(branch.totals),
      '',
      ...historyValues(data, branch.name),
    ];
    styleTotalRow(totalRow);
  }

  const companyRow = sheet.getRow(rowNumber++);
  companyRow.values = [
    'TOTAL COMPANY',
    ...componentValues(data.company),
    '',
    ...historyValues(data, 'Total Company'),
  ];
  styleTotalRow(companyRow, 'FFFFE1D3');
  companyRow.font = { bold: true, color: { argb: BLUE }, size: 11 };

  rowNumber++;
  const dashboardRow = sheet.getRow(rowNumber++);
  dashboardRow.values = ['Dashboard grand total', ...Array(10).fill(''), '', data.reconciliationGrandTotal];
  const workbookRow = sheet.getRow(rowNumber++);
  workbookRow.values = ['Workbook revenue MTD', ...Array(10).fill(''), '', data.company.revenue.mtd];
  const differenceRow = sheet.getRow(rowNumber++);
  differenceRow.values = ['Difference', ...Array(10).fill(''), '', data.difference];
  [dashboardRow, workbookRow, differenceRow].forEach((row) => styleTotalRow(row, LIGHT_GRAY));

  for (let row = 5; row <= sheet.rowCount; row++) {
    for (let col = 2; col <= 11; col++) sheet.getCell(row, col).numFmt = '#,##0.0';
    for (let col = 12; col <= 15; col++) sheet.getCell(row, col).numFmt = '$#,##0.00';
    for (let col = 17; col < historyCol; col += 3) {
      sheet.getCell(row, col).numFmt = '#,##0';
      sheet.getCell(row, col + 1).numFmt = '#,##0';
      sheet.getCell(row, col + 2).numFmt = '$#,##0.00';
    }
  }
  dashboardRow.getCell(13).numFmt = '$#,##0.00';
  workbookRow.getCell(13).numFmt = '$#,##0.00';
  differenceRow.getCell(13).numFmt = '$#,##0.00';
  sheet.autoFilter = { from: 'A4', to: 'O4' };
}

function repCountValues(rep) {
  const result = [];
  for (const group of ['openings', 'closings']) {
    for (const period of ['day', 'mtd']) {
      let total = 0;
      for (const category of R14_CATEGORIES) {
        const value = rep[group][period][category] || 0;
        result.push(value);
        total += value;
      }
      result.push(total);
    }
  }
  return result;
}

function configureRepSheet(sheet, data) {
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
  sheet.properties.defaultRowHeight = 18;
  sheet.getColumn(1).width = 28;
  for (let col = 2; col <= 21; col++) sheet.getColumn(col).width = 9;
  for (let col = 22; col <= 24; col++) sheet.getColumn(col).width = 14;

  sheet.mergeCells('A1:X1');
  sheet.getCell('A1').value = `By Rep — dashboard R-14 as of ${longDate(data.asOf)}`;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: BLUE } };

  const groups = [
    [2, 6, 'OPENINGS Day'],
    [7, 11, 'OPENINGS MTD'],
    [12, 16, 'CLOSINGS Day'],
    [17, 21, 'CLOSINGS MTD'],
    [22, 24, 'REVENUE'],
  ];
  sheet.getCell('A3').value = 'REP';
  styleHeader(sheet.getCell('A3'));
  for (const [start, end, label] of groups) {
    sheet.mergeCells(3, start, 3, end);
    sheet.getCell(3, start).value = label;
    styleHeader(sheet.getCell(3, start));
  }
  const countHeaders = ['Sal', 'Ref', 'Esc', 'TSG', 'Tot'];
  let col = 2;
  for (let block = 0; block < 4; block++) {
    for (const label of countHeaders) {
      const cell = sheet.getCell(4, col++);
      cell.value = label;
      styleHeader(cell, ORANGE);
    }
  }
  for (const label of ['Today', 'MTD', 'Proj']) {
    const cell = sheet.getCell(4, col++);
    cell.value = label;
    styleHeader(cell, ORANGE);
  }
  styleHeader(sheet.getCell('A4'), ORANGE);
  sheet.getCell('A4').value = 'Rep';

  let rowNumber = 5;
  for (const branch of data.reps.branches) {
    const branchRow = sheet.getRow(rowNumber++);
    branchRow.getCell(1).value = branch.name;
    branchRow.font = { bold: true, color: { argb: BLUE } };
    setFill(branchRow.getCell(1), LIGHT_GRAY);
    for (const rep of branch.reps) {
      const row = sheet.getRow(rowNumber++);
      row.values = [
        rep.name,
        ...repCountValues(rep),
        rep.revenue.day,
        rep.revenue.mtd,
        rep.revenue.proj,
      ];
    }
    const subtotal = sheet.getRow(rowNumber++);
    subtotal.values = [
      `${branch.name} Total`,
      ...repCountValues(branch.subtotal),
      branch.subtotal.revenue.day,
      branch.subtotal.revenue.mtd,
      branch.subtotal.revenue.proj,
    ];
    styleTotalRow(subtotal);
  }
  const companyRow = sheet.getRow(rowNumber++);
  companyRow.values = [
    'TOTAL COMPANY',
    ...repCountValues(data.reps.company),
    data.reps.company.revenue.day,
    data.reps.company.revenue.mtd,
    data.reps.company.revenue.proj,
  ];
  styleTotalRow(companyRow, 'FFFFE1D3');
  for (let row = 5; row <= sheet.rowCount; row++) {
    for (let countCol = 2; countCol <= 21; countCol++) {
      sheet.getCell(row, countCol).numFmt = '#,##0';
    }
    for (let revenueCol = 22; revenueCol <= 24; revenueCol++) {
      sheet.getCell(row, revenueCol).numFmt = '$#,##0.00';
    }
  }
  sheet.autoFilter = { from: 'A4', to: 'X4' };
}

async function buildDailyExcel(asOfDate) {
  const data = await collectDailyExcelData(asOfDate);
  if (Math.abs(data.difference) > 0.01) {
    throw new Error(
      `daily Excel revenue does not reconcile: workbook ${data.company.revenue.mtd.toFixed(2)} ` +
      `vs dashboard ${data.reconciliationGrandTotal.toFixed(2)}`
    );
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pacific Coast Title';
  workbook.title = `PCT Daily Report ${data.asOf}`;
  workbook.subject = 'Read-only rendering of manager dashboard data';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;
  workbook.calcProperties.forceFullCalc = false;
  configureDailySheet(workbook.addWorksheet('Daily Report'), data);
  configureRepSheet(workbook.addWorksheet('By Rep'), data);
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

async function sendDailyExcelTest(testEmail = TEST_EMAIL) {
  if (testEmail !== TEST_EMAIL) {
    throw new Error(`test delivery is restricted to ${TEST_EMAIL}`);
  }
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error('SENDGRID_API_KEY not set');
  sgMail.setApiKey(apiKey);
  const asOf = pacificDateString();
  const buffer = await buildDailyExcel(asOf);
  const filename = `PCT_Daily_Report_${asOf}.xlsx`;
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  await sgMail.send({
    to: TEST_EMAIL,
    from,
    subject: `[TEST] PCT Daily Excel — ${longDate(asOf)}`,
    html: `
      <div style="background:#fef3c7;color:#92400e;padding:12px 20px;text-align:center;font-family:Arial,sans-serif;font-weight:700;">
        TEST ONLY — Tom and Al did not receive this email
      </div>
      <p style="font-family:Arial,sans-serif;">Attached is the read-only PCT Daily Excel proof of concept.</p>
    `,
    attachments: [{
      content: buffer.toString('base64'),
      filename,
      type: EXCEL_MIME,
      disposition: 'attachment',
    }],
  });
  return { sent: true, sentTo: TEST_EMAIL, filename, bytes: buffer.length };
}

module.exports = {
  buildDailyExcel,
  collectDailyExcelData,
  sendDailyExcelTest,
  pacificDateString,
  EXCEL_MIME,
};
