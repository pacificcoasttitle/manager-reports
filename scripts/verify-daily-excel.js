const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const pool = require('../database/pool');
const { buildDailyExcel, MASTER_PATH } = require('../lib/daily-excel');

const R14_INPUT_COLUMNS = ['E','F','G','J','K','L','O','Q','R','S','V','W','X','Z','AA','AB','AC','AD','AH','AI','AJ','AL','AM'];
const R14_SLOT_ROWS = [
  ...Array.from({ length: 37 }, (_, i) => i + 9),
  ...Array.from({ length: 35 }, (_, i) => i + 49),
];
const ESCROW_INPUT_COLUMNS = ['D','E','F','H','I','J','L','M','N','O'];
const ESCROW_DETAIL_ROWS = [
  17,18,20,21,23,24,28,29,31,32,34,35,39,40,
  44,45,52,53,55,56,59,60,67,68,72,73,75,76,
];

function args() {
  const values = {};
  for (const item of process.argv.slice(2)) {
    if (item === '--inspect-only') values.inspectOnly = true;
    else {
      const match = item.match(/^--([^=]+)=(.*)$/);
      if (match) values[match[1]] = match[2];
    }
  }
  return values;
}

function shiftDate(value, days) {
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function shiftMonth(value, months) {
  const parsed = new Date(`${value}-01T12:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  return parsed.toISOString().slice(0, 7);
}

function number(value) {
  return Number.parseFloat(value) || 0;
}

function cellNumber(sheet, address) {
  const cell = sheet.getCell(address);
  return number(cell.result ?? cell.value);
}

function sumCells(sheet, addresses) {
  return addresses.reduce((sum, address) => sum + cellNumber(sheet, address), 0);
}

function sumRange(sheet, column, startRow, endRow) {
  let total = 0;
  for (let row = startRow; row <= endRow; row++) total += cellNumber(sheet, `${column}${row}`);
  return total;
}

function formulaCounts(workbook) {
  return Object.fromEntries(workbook.worksheets.map((sheet) => {
    let count = 0;
    sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.formula !== undefined) count++;
    }));
    return [sheet.name, count];
  }));
}

function workbookViewState(workbook) {
  const workbookView = workbook.views?.[0] || {};
  const activeTab = workbookView.activeTab ?? 0;
  const activeSheet = workbook.worksheets[activeTab];
  const pro = workbook.getWorksheet('pro');
  const proView = pro.views?.[0] || {};
  return {
    workbookView,
    activeTab,
    activeSheet: activeSheet?.name || null,
    proView,
    proActiveCell: proView.activeCell || 'A1',
    proTopLeftCell: proView.topLeftCell || 'A1',
  };
}

function refErrors(workbook) {
  const refs = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
      if (String(cell.formula || '').includes('#REF!')
          || JSON.stringify(cell.value ?? '').includes('#REF!')) {
        refs.push(`${sheet.name}!${cell.address}`);
      }
    }));
  }
  return refs;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`
    );
  }
}

function commandWorks(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function recalculateWithLibreOffice(workbookPath, command) {
  const root = path.dirname(workbookPath);
  const inputDir = path.join(root, 'libreoffice-input');
  const outputDir = path.join(root, 'libreoffice-output');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const input = path.join(inputDir, path.basename(workbookPath));
  fs.copyFileSync(workbookPath, input);
  run(command, ['--headless', '--convert-to', 'xlsx', '--outdir', outputDir, input]);
  const output = path.join(outputDir, path.basename(workbookPath));
  if (!fs.existsSync(output)) throw new Error('LibreOffice did not produce a recalculated workbook');
  fs.copyFileSync(output, workbookPath);
}

function recalculate(workbookPath) {
  if (process.platform === 'win32') {
    const script = path.join(__dirname, 'recalculate-daily-excel.ps1');
    run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-WorkbookPath', workbookPath,
    ]);
    return 'Microsoft Excel CalculateFullRebuild';
  }
  for (const command of ['soffice', 'libreoffice']) {
    if (commandWorks(command)) {
      recalculateWithLibreOffice(workbookPath, command);
      return `${command} headless`;
    }
  }
  throw new Error(
    'No spreadsheet calculation engine found. Gate stopped rather than reading cached formula results.'
  );
}

async function dashboardExpected(asOf) {
  const reportDate = shiftDate(asOf, -1);
  const month = reportDate.slice(0, 7);
  const priorMonth = shiftMonth(month, -1);
  const prior2Month = shiftMonth(month, -2);
  const [openResult, closeResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE received_date::date = $2::date
          AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title only', 'title & escrow'))::int AS title_day,
        COUNT(*) FILTER (WHERE open_month = $1 AND received_date::date <= $2::date
          AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title only', 'title & escrow'))::int AS title_mtd,
        COUNT(*) FILTER (WHERE open_month = $3
          AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title only', 'title & escrow'))::int AS title_prior,
        COUNT(*) FILTER (WHERE open_month = $4
          AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title only', 'title & escrow'))::int AS title_prior2,
        COUNT(*) FILTER (WHERE received_date::date = $2::date
          AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title & escrow', 'escrow only'))::int AS escrow_day,
        COUNT(*) FILTER (WHERE open_month = $1 AND received_date::date <= $2::date
          AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title & escrow', 'escrow only'))::int AS escrow_mtd,
        COUNT(*) FILTER (WHERE open_month = $3
          AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title & escrow', 'escrow only'))::int AS escrow_prior,
        COUNT(*) FILTER (WHERE open_month = $4
          AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title & escrow', 'escrow only'))::int AS escrow_prior2,
        COUNT(*) FILTER (WHERE received_date::date = $2::date
          AND (LOWER(TRIM(COALESCE(order_type, ''))) = 'trustee sale guarantee' OR category = 'TSG'))::int AS tsg_day,
        COUNT(*) FILTER (WHERE open_month = $1 AND received_date::date <= $2::date
          AND (LOWER(TRIM(COALESCE(order_type, ''))) = 'trustee sale guarantee' OR category = 'TSG'))::int AS tsg_mtd,
        COUNT(*) FILTER (WHERE open_month = $3
          AND (LOWER(TRIM(COALESCE(order_type, ''))) = 'trustee sale guarantee' OR category = 'TSG'))::int AS tsg_prior,
        COUNT(*) FILTER (WHERE open_month = $4
          AND (LOWER(TRIM(COALESCE(order_type, ''))) = 'trustee sale guarantee' OR category = 'TSG'))::int AS tsg_prior2,
        COUNT(*) FILTER (WHERE received_date::date = $2::date
          AND LOWER(TRIM(COALESCE(order_type, ''))) = 'title & escrow')::int AS te_day,
        COUNT(*) FILTER (WHERE open_month = $1 AND received_date::date <= $2::date
          AND LOWER(TRIM(COALESCE(order_type, ''))) = 'title & escrow')::int AS te_mtd,
        COUNT(*) FILTER (WHERE open_month = $3
          AND LOWER(TRIM(COALESCE(order_type, ''))) = 'title & escrow')::int AS te_prior
      FROM open_orders
      WHERE open_month IN ($1, $3, $4)
        AND file_number NOT ILIKE 'test%'
        AND file_number NOT ILIKE 'ar test%'
        AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)
    `, [month, reportDate, priorMonth, prior2Month]),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE transaction_date::date = $2::date
          AND COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) > 0)::int AS title_day,
        COUNT(*) FILTER (WHERE fetch_month = $1 AND transaction_date::date <= $2::date
          AND COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) > 0)::int AS title_mtd,
        COUNT(*) FILTER (WHERE fetch_month = $3
          AND COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) > 0)::int AS title_prior,
        COUNT(*) FILTER (WHERE transaction_date::date = $2::date AND COALESCE(escrow_revenue, 0) > 0)::int AS escrow_day,
        COUNT(*) FILTER (WHERE fetch_month = $1 AND transaction_date::date <= $2::date
          AND COALESCE(escrow_revenue, 0) > 0)::int AS escrow_mtd,
        COUNT(*) FILTER (WHERE fetch_month = $3 AND COALESCE(escrow_revenue, 0) > 0)::int AS escrow_prior,
        COUNT(*) FILTER (WHERE transaction_date::date = $2::date AND COALESCE(tsg_revenue, 0) > 0)::int AS tsg_day,
        COUNT(*) FILTER (WHERE fetch_month = $1 AND transaction_date::date <= $2::date
          AND COALESCE(tsg_revenue, 0) > 0)::int AS tsg_mtd,
        COUNT(*) FILTER (WHERE fetch_month = $3 AND COALESCE(tsg_revenue, 0) > 0)::int AS tsg_prior,
        COUNT(*) FILTER (WHERE transaction_date::date = $2::date
          AND COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) > 0
          AND COALESCE(escrow_revenue, 0) > 0)::int AS te_day,
        COUNT(*) FILTER (WHERE fetch_month = $1 AND transaction_date::date <= $2::date
          AND COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) > 0
          AND COALESCE(escrow_revenue, 0) > 0)::int AS te_mtd,
        ROUND(SUM(CASE WHEN transaction_date::date = $2::date
          THEN COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) ELSE 0 END)::numeric, 2) AS title_revenue_day,
        ROUND(SUM(CASE WHEN fetch_month = $1 AND transaction_date::date <= $2::date
          THEN COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) ELSE 0 END)::numeric, 2) AS title_revenue_mtd,
        ROUND(SUM(CASE WHEN fetch_month = $3
          THEN COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) ELSE 0 END)::numeric, 2) AS title_revenue_prior,
        ROUND(SUM(CASE WHEN fetch_month = $4
          THEN COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) ELSE 0 END)::numeric, 2) AS title_revenue_prior2,
        ROUND(SUM(CASE WHEN transaction_date::date = $2::date THEN COALESCE(escrow_revenue, 0) ELSE 0 END)::numeric, 2) AS escrow_revenue_day,
        ROUND(SUM(CASE WHEN fetch_month = $1 AND transaction_date::date <= $2::date
          THEN COALESCE(escrow_revenue, 0) ELSE 0 END)::numeric, 2) AS escrow_revenue_mtd,
        ROUND(SUM(CASE WHEN fetch_month = $3 THEN COALESCE(escrow_revenue, 0) ELSE 0 END)::numeric, 2) AS escrow_revenue_prior,
        ROUND(SUM(CASE WHEN fetch_month = $4 THEN COALESCE(escrow_revenue, 0) ELSE 0 END)::numeric, 2) AS escrow_revenue_prior2,
        ROUND(SUM(CASE WHEN transaction_date::date = $2::date THEN COALESCE(tsg_revenue, 0) ELSE 0 END)::numeric, 2) AS tsg_revenue_day,
        ROUND(SUM(CASE WHEN fetch_month = $1 AND transaction_date::date <= $2::date
          THEN COALESCE(tsg_revenue, 0) ELSE 0 END)::numeric, 2) AS tsg_revenue_mtd,
        ROUND(SUM(CASE WHEN fetch_month = $3 THEN COALESCE(tsg_revenue, 0) ELSE 0 END)::numeric, 2) AS tsg_revenue_prior,
        ROUND(SUM(CASE WHEN fetch_month = $4 THEN COALESCE(tsg_revenue, 0) ELSE 0 END)::numeric, 2) AS tsg_revenue_prior2,
        ROUND(SUM(CASE WHEN transaction_date::date = $2::date THEN COALESCE(total_revenue, 0) ELSE 0 END)::numeric, 2) AS total_revenue_day,
        ROUND(SUM(CASE WHEN fetch_month = $1 AND transaction_date::date <= $2::date
          THEN COALESCE(total_revenue, 0) ELSE 0 END)::numeric, 2) AS total_revenue_mtd,
        ROUND(SUM(CASE WHEN fetch_month = $3 THEN COALESCE(total_revenue, 0) ELSE 0 END)::numeric, 2) AS total_revenue_prior,
        ROUND(SUM(CASE WHEN fetch_month = $4 THEN COALESCE(total_revenue, 0) ELSE 0 END)::numeric, 2) AS total_revenue_prior2
      FROM order_summary
      WHERE fetch_month IN ($1, $3, $4) AND transaction_date IS NOT NULL
    `, [month, reportDate, priorMonth, prior2Month]),
  ]);
  const opens = openResult.rows[0];
  const closes = closeResult.rows[0];
  const result = { reportDate, month, priorMonth, prior2Month };
  for (const prefix of ['title', 'escrow', 'tsg', 'te']) {
    for (const suffix of ['day', 'mtd', 'prior', 'prior2']) {
      if (opens[`${prefix}_${suffix}`] !== undefined) {
        result[`${prefix}Open${suffix[0].toUpperCase()}${suffix.slice(1)}`] =
          number(opens[`${prefix}_${suffix}`]);
      }
      if (closes[`${prefix}_${suffix}`] !== undefined) {
        result[`${prefix}Close${suffix[0].toUpperCase()}${suffix.slice(1)}`] =
          number(closes[`${prefix}_${suffix}`]);
      }
    }
  }
  for (const prefix of ['title', 'escrow', 'tsg', 'total']) {
    for (const suffix of ['day', 'mtd', 'prior', 'prior2']) {
      result[`${prefix}Revenue${suffix[0].toUpperCase()}${suffix.slice(1)}`] =
        number(closes[`${prefix}_revenue_${suffix}`]);
    }
  }
  return result;
}

function findGhostInputs(workbook) {
  const ghosts = [];
  const r14 = workbook.getWorksheet('r14');
  for (const row of R14_SLOT_ROWS) {
    if (r14.getCell(`B${row}`).text.trim()) continue;
    for (const col of R14_INPUT_COLUMNS) {
      const value = cellNumber(r14, `${col}${row}`);
      if (Math.abs(value) > 0.0001) ghosts.push(`r14!${col}${row}=${value}`);
    }
  }
  const escrow = workbook.getWorksheet('Escrow');
  for (const row of ESCROW_DETAIL_ROWS) {
    if (escrow.getCell(`C${row}`).text.trim()) continue;
    for (const col of ESCROW_INPUT_COLUMNS) {
      const value = cellNumber(escrow, `${col}${row}`);
      if (Math.abs(value) > 0.0001) ghosts.push(`Escrow!${col}${row}=${value}`);
    }
  }
  return ghosts;
}

function assertExact(failures, name, actual, expected) {
  if (Math.abs(number(actual) - number(expected)) > 0.005) {
    failures.push(`${name}: actual=${actual}, expected=${expected}`);
  }
}

function auditValue(check, failures, name, actual, expected, tolerance = 0.005) {
  const difference = number(actual) - number(expected);
  check.details[name] = {
    actual: number(actual),
    expected: number(expected),
    difference,
  };
  if (Math.abs(difference) > tolerance) {
    check.pass = false;
    failures.push(`${name}: actual=${actual}, expected=${expected}`);
  }
}

async function main() {
  const options = args();
  const asOf = options['as-of'] || '2026-10-07';
  const outputDir = path.resolve(options['out-dir'] || path.join('_scratch', 'daily-excel-gate'));
  fs.mkdirSync(outputDir, { recursive: true });
  const workbookPath = path.join(
    outputDir,
    options.source ? 'source.recalculated.xlsx' : `PCT_Daily_Report_${asOf}.recalculated.xlsx`
  );

  let buildMetadata = null;
  let calcPropertiesBeforeRecalculation = null;
  let generatedViewState = null;
  let generatedTabSelectedSheets = null;
  if (options.source) {
    fs.copyFileSync(path.resolve(options.source), workbookPath);
  } else {
    const buffer = await buildDailyExcel(asOf);
    buildMetadata = buffer.dailyExcelMetadata;
    const zip = await JSZip.loadAsync(buffer);
    const workbookXml = await zip.file('xl/workbook.xml').async('string');
    calcPropertiesBeforeRecalculation = {
      fullCalcOnLoad: /<calcPr\b[^>]*\bfullCalcOnLoad="1"/i.test(workbookXml),
    };
    const generatedWorkbook = new ExcelJS.Workbook();
    await generatedWorkbook.xlsx.load(buffer);
    generatedViewState = workbookViewState(generatedWorkbook);
    generatedTabSelectedSheets = [];
    for (let index = 0; index < generatedWorkbook.worksheets.length; index++) {
      const sheet = generatedWorkbook.worksheets[index];
      const sheetXml = await zip.file(`xl/worksheets/sheet${sheet.id}.xml`).async('string');
      if (/<sheetView\b[^>]*\btabSelected="1"/i.test(sheetXml)) {
        generatedTabSelectedSheets.push(sheet.name);
      }
    }
    fs.writeFileSync(workbookPath, buffer);
  }

  const engine = recalculate(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const pro = workbook.getWorksheet('pro');
  const escrow = workbook.getWorksheet('Escrow');
  const r14 = workbook.getWorksheet('r14');

  const actual = {
    glendaleEscrowOpenDay: cellNumber(pro, 'E17'),
    glendaleEscrowOpenMtd: cellNumber(pro, 'F17'),
    escrowTabGlendaleOpenDay: cellNumber(escrow, 'D48'),
    escrowTabGlendaleOpenMtd: cellNumber(escrow, 'E48'),
    titleOpenDay: sumCells(pro, ['E48','E49']),
    titleOpenMtd: sumCells(pro, ['F48','F49']),
    titleCloseDay: sumCells(pro, ['K48','K49']),
    titleCloseMtd: sumCells(pro, ['L48','L49']),
    titleRevenueDay: sumCells(pro, ['Q48','Q49']),
    titleRevenueMtd: sumCells(pro, ['R48','R49']),
    escrowOpenDay: cellNumber(pro, 'E47'),
    escrowOpenMtd: cellNumber(pro, 'F47'),
    escrowCloseDay: cellNumber(pro, 'K47'),
    escrowCloseMtd: cellNumber(pro, 'L47'),
    escrowRevenueDay: cellNumber(pro, 'Q47'),
    escrowRevenueMtd: cellNumber(pro, 'R47'),
    tsgOpenDay: cellNumber(pro, 'E50'),
    tsgOpenMtd: cellNumber(pro, 'F50'),
    tsgCloseDay: cellNumber(pro, 'K50'),
    tsgCloseMtd: cellNumber(pro, 'L50'),
    tsgRevenueDay: cellNumber(pro, 'Q50'),
    tsgRevenueMtd: cellNumber(pro, 'R50'),
    totalRevenueDay: cellNumber(pro, 'Q53'),
    totalRevenueMtd: cellNumber(pro, 'R53'),
  };
  const expected = await dashboardExpected(asOf);
  const ghosts = findGhostInputs(workbook);
  const failures = [];
  const checks = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
    `check${index + 1}`, { pass: true, details: {} },
  ]));

  // Check 1 — live internal/dashboard comparison controls.
  const checkCells = [
    ...['E','F','G','H','I','K','L','M','N','O','Q','R','S','T','U','W','X','AB'].map((col) => `${col}56`),
    ...['E','F','I','K','L','O','Q','R','T','U','W','X','AB','AD','AE'].map((col) => `${col}59`),
  ];
  for (const address of checkCells) {
    auditValue(checks.check1, failures, `pro!${address}`, cellNumber(pro, address), 0);
  }

  // Check 2 — pro branch, Southern California, and Total Company subtotals.
  const proComponentColumns = ['E','F','I','K','L','O','Q','R','T','U','AB'];
  for (const col of proComponentColumns) {
    auditValue(
      checks.check2, failures, `pro!${col}51 Southern California`,
      cellNumber(pro, `${col}51`), sumRange(pro, col, 47, 50)
    );
    auditValue(
      checks.check2, failures, `pro!${col}53 Total Company`,
      cellNumber(pro, `${col}53`),
      sumCells(pro, [`${col}51`, `${col}14`, `${col}6`])
    );
  }
  checks.check2.details.glendaleRow48References = [];
  pro.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
    if (String(cell.formula || '').match(/Escrow![A-Z]+48/i)) {
      checks.check2.details.glendaleRow48References.push(`pro!${cell.address}=${cell.formula}`);
    }
  }));

  // Check 3 — pro title rows versus r14.
  const proR14Grand = [
    ['openings Day', ['E48','E49','E50'], 'H104'],
    ['openings MTD', ['F48','F49','F50'], 'M104'],
    ['openings Prior', ['I48','I49','I50'], 'O104'],
    ['closings Day', ['K48','K49','K50'], 'T104'],
    ['closings MTD', ['L48','L49','L50'], 'Y104'],
    ['closings Prior', ['O48','O49','O50'], 'Z104'],
    ['revenue Day', ['Q48','Q49','Q50'], 'AE104'],
    ['revenue MTD', ['R48','R49','R50'], 'AK104'],
    ['revenue Prior', ['T48','T49','T50'], 'AL104'],
    ['revenue Prior2', ['U48','U49','U50'], 'AM104'],
  ];
  for (const [label, proCells, r14Cell] of proR14Grand) {
    auditValue(
      checks.check3, failures, `pro↔r14 ${label}`,
      sumCells(pro, proCells), cellNumber(r14, r14Cell)
    );
  }
  const branchCategoryMappings = [
    ['Glendale Sale',18,46,'E','J','Q','V','AB','AH'],
    ['Glendale Refi',19,46,'F','K','R','W','AC','AI'],
    ['Orange Sale',31,84,'E','J','Q','V','AB','AH'],
    ['Orange Refi',32,84,'F','K','R','W','AC','AI'],
  ];
  const proMetricCols = ['E','F','K','L','Q','R'];
  for (const [label, proRow, r14Row, ...r14Cols] of branchCategoryMappings) {
    for (let index = 0; index < proMetricCols.length; index++) {
      auditValue(
        checks.check3, failures, `${label} ${proMetricCols[index]}`,
        cellNumber(pro, `${proMetricCols[index]}${proRow}`),
        cellNumber(r14, `${r14Cols[index]}${r14Row}`)
      );
    }
  }

  // Check 4 — every pro escrow row versus its Escrow office total.
  const proEscrowMappings = [[17,48],[30,63],[41,69],[44,77],[47,79]];
  const proEscrowCols = ['E','F','I','K','L','O','Q','R','T','U'];
  const escrowCols = ['D','E','F','H','I','J','L','M','N','O'];
  for (const [proRow, escrowRow] of proEscrowMappings) {
    for (let index = 0; index < proEscrowCols.length; index++) {
      auditValue(
        checks.check4, failures, `pro!${proEscrowCols[index]}${proRow}↔Escrow!${escrowCols[index]}${escrowRow}`,
        cellNumber(pro, `${proEscrowCols[index]}${proRow}`),
        cellNumber(escrow, `${escrowCols[index]}${escrowRow}`)
      );
    }
  }

  // Check 5 — in-tab subtotals, complete formula slots, and orphan inputs.
  const r14RawTotalColumns = ['H','M','T','Y','AE','AK','O','Z','AL','AM'];
  for (const [subtotalRow, startRow, endRow] of [[46,9,45],[84,49,83],[102,87,101]]) {
    for (const col of r14RawTotalColumns) {
      auditValue(
        checks.check5, failures, `r14!${col}${subtotalRow} section total`,
        cellNumber(r14, `${col}${subtotalRow}`), sumRange(r14, col, startRow, endRow)
      );
    }
  }
  for (const col of r14RawTotalColumns) {
    auditValue(
      checks.check5, failures, `r14!${col}104 grand total`,
      cellNumber(r14, `${col}104`),
      sumCells(r14, [`${col}46`, `${col}84`, `${col}102`])
    );
  }
  for (const [detailCols, totalCol] of [
    [['E','F','G'],'H'], [['J','K','L'],'M'], [['Q','R','S'],'T'],
    [['V','W','X'],'Y'], [['AB','AC','AD'],'AE'], [['AH','AI','AJ'],'AK'],
  ]) {
    auditValue(
      checks.check5, failures, `r14 category+special reconstruction ${totalCol}104`,
      sumCells(r14, detailCols.map((col) => `${col}104`))
        + sumCells(r14, detailCols.map((col) => `${col}106`)),
      cellNumber(r14, `${totalCol}104`)
    );
  }
  for (const row of R14_SLOT_ROWS) {
    const isUsedSlot = Boolean(r14.getCell(`B${row}`).text.trim())
      || R14_INPUT_COLUMNS.some((col) => Math.abs(cellNumber(r14, `${col}${row}`)) > 0.0001);
    if (!isUsedSlot) continue;
    for (const col of ['H','M','N','T','Y','AE','AK']) {
      if (r14.getCell(`${col}${row}`).formula === undefined) {
        checks.check5.pass = false;
        failures.push(`missing r14 formula ${col}${row}`);
      }
    }
    for (const [totalCol, componentCols] of [
      ['H',['E','F','G']], ['M',['J','K','L']], ['T',['Q','R','S']],
      ['Y',['V','W','X']], ['AE',['AB','AC','AD']], ['AK',['AH','AI','AJ']],
    ]) {
      auditValue(
        checks.check5, failures, `r14!${totalCol}${row} slot total`,
        cellNumber(r14, `${totalCol}${row}`),
        sumCells(r14, componentCols.map((col) => `${col}${row}`))
      );
    }
  }
  const escrowSubtotals = [
    [25,[20,21,22,23,24]], [46,[44,45]], [48,[25,46]],
    [57,[55,56]], [61,[59,60]], [63,[57,61]], [69,[67,68]],
    [77,[72,73,75,76]], [79,[48,63,69,77]],
  ];
  for (const [totalRow, componentRows] of escrowSubtotals) {
    for (const col of ESCROW_INPUT_COLUMNS) {
      auditValue(
        checks.check5, failures, `Escrow!${col}${totalRow} subtotal`,
        cellNumber(escrow, `${col}${totalRow}`),
        sumCells(escrow, componentRows.map((row) => `${col}${row}`))
      );
    }
  }
  checks.check5.details.ghostInputs = ghosts;
  if (ghosts.length) {
    checks.check5.pass = false;
    failures.push(`ghost inputs: ${ghosts.join(', ')}`);
  }

  // Check 6 — shared date/working-day drivers and Avg/Proj arithmetic.
  const drivers = {
    pro: { day: cellNumber(pro,'J1'), year: cellNumber(pro,'K1'), elapsed: cellNumber(pro,'O1'), total: cellNumber(pro,'Q1') },
    r14: { day: cellNumber(r14,'L1'), year: cellNumber(r14,'M1'), elapsed: cellNumber(r14,'P1'), total: cellNumber(r14,'R1') },
    escrow: { day: cellNumber(escrow,'H1'), year: cellNumber(escrow,'I1'), elapsed: cellNumber(escrow,'K1'), total: cellNumber(escrow,'M1') },
  };
  for (const tab of ['r14','escrow']) {
    for (const field of ['day','year','elapsed','total']) {
      auditValue(checks.check6, failures, `${tab} ${field} driver`, drivers[tab][field], drivers.pro[field]);
    }
  }
  for (let row = 1; row <= 59; row++) {
    for (const [avgCol, monthCol, projCol] of [['G','F','H'],['M','L','N']]) {
      if (pro.getCell(`${avgCol}${row}`).formula !== undefined) {
        const average = drivers.pro.elapsed ? cellNumber(pro, `${monthCol}${row}`) / drivers.pro.elapsed : 0;
        auditValue(checks.check6, failures, `pro!${avgCol}${row} Avg`, cellNumber(pro, `${avgCol}${row}`), average);
        auditValue(checks.check6, failures, `pro!${projCol}${row} Proj`, cellNumber(pro, `${projCol}${row}`), average * drivers.pro.total);
      }
    }
    if (pro.getCell(`S${row}`).formula !== undefined) {
      const projected = drivers.pro.elapsed
        ? cellNumber(pro, `R${row}`) / drivers.pro.elapsed * drivers.pro.total : 0;
      auditValue(checks.check6, failures, `pro!S${row} Revenue Proj`, cellNumber(pro, `S${row}`), projected);
    }
  }
  for (const row of [...R14_SLOT_ROWS,46,84,102,104]) {
    if (r14.getCell(`N${row}`).formula !== undefined) {
      const projected = drivers.r14.elapsed
        ? cellNumber(r14, `M${row}`) / drivers.r14.elapsed * drivers.r14.total : 0;
      auditValue(checks.check6, failures, `r14!N${row} Proj`, cellNumber(r14, `N${row}`), projected);
    }
  }
  auditValue(
    checks.check6, failures, 'Mark Neveu projection N28', cellNumber(r14,'N28'),
    drivers.r14.elapsed ? cellNumber(r14,'M28') / drivers.r14.elapsed * drivers.r14.total : 0
  );
  auditValue(
    checks.check6, failures, 'Dan Culnane projection N51', cellNumber(r14,'N51'),
    drivers.r14.elapsed ? cellNumber(r14,'M51') / drivers.r14.elapsed * drivers.r14.total : 0
  );
  checks.check6.details.drivers = drivers;

  // Check 7 — dashboard convention: T&E appears in both title and escrow counts.
  const dashboardComparisons = {
    titleOpenDay: actual.titleOpenDay,
    titleOpenMtd: actual.titleOpenMtd,
    titleCloseDay: actual.titleCloseDay,
    titleCloseMtd: actual.titleCloseMtd,
    titleRevenueDay: actual.titleRevenueDay,
    titleRevenueMtd: actual.titleRevenueMtd,
    escrowOpenDay: actual.escrowOpenDay,
    escrowOpenMtd: actual.escrowOpenMtd,
    escrowCloseDay: actual.escrowCloseDay,
    escrowCloseMtd: actual.escrowCloseMtd,
    escrowRevenueDay: actual.escrowRevenueDay,
    escrowRevenueMtd: actual.escrowRevenueMtd,
    tsgOpenDay: actual.tsgOpenDay,
    tsgOpenMtd: actual.tsgOpenMtd,
    tsgCloseDay: actual.tsgCloseDay,
    tsgCloseMtd: actual.tsgCloseMtd,
    tsgRevenueDay: actual.tsgRevenueDay,
    tsgRevenueMtd: actual.tsgRevenueMtd,
    totalRevenueDay: actual.totalRevenueDay,
    totalRevenueMtd: actual.totalRevenueMtd,
  };
  for (const [key, value] of Object.entries(dashboardComparisons)) {
    auditValue(checks.check7, failures, key, value, expected[key]);
  }
  const priorComparisons = {
    titleOpenPrior: sumCells(pro,['I48','I49']),
    titleOpenPrior2: sumCells(pro,['AB48','AB49']),
    tsgOpenPrior: cellNumber(pro,'I50'),
    tsgOpenPrior2: cellNumber(pro,'AB50'),
    escrowOpenPrior: cellNumber(pro,'I47'),
    escrowOpenPrior2: cellNumber(pro,'AB47'),
    titleClosePrior: sumCells(pro,['O48','O49']),
    tsgClosePrior: cellNumber(pro,'O50'),
    escrowClosePrior: cellNumber(pro,'O47'),
    titleRevenuePrior: sumCells(pro,['T48','T49']),
    titleRevenuePrior2: sumCells(pro,['U48','U49']),
    tsgRevenuePrior: cellNumber(pro,'T50'),
    tsgRevenuePrior2: cellNumber(pro,'U50'),
    escrowRevenuePrior: cellNumber(pro,'T47'),
    escrowRevenuePrior2: cellNumber(pro,'U47'),
    totalRevenuePrior: cellNumber(pro,'T53'),
    totalRevenuePrior2: cellNumber(pro,'U53'),
  };
  for (const [key, value] of Object.entries(priorComparisons)) {
    auditValue(checks.check7, failures, key, value, expected[key]);
  }
  checks.check7.details.titleAndEscrowOverlap = {
    openingsDay: expected.teOpenDay,
    openingsMtd: expected.teOpenMtd,
    openingsPrior: expected.teOpenPrior,
    closingsDay: expected.teCloseDay,
    closingsMtd: expected.teCloseMtd,
    uniqueFileFormulaAssumption: false,
  };

  // Fidelity checks run on the same recalculated workbook.
  const master = new ExcelJS.Workbook();
  await master.xlsx.readFile(MASTER_PATH);
  const calculatedFormulaCounts = formulaCounts(workbook);
  const masterFormulaCounts = formulaCounts(master);
  for (const sheet of ['pro','Escrow','r14']) {
    if (calculatedFormulaCounts[sheet] !== masterFormulaCounts[sheet]) {
      failures.push(`formula count ${sheet}: recalculated=${calculatedFormulaCounts[sheet]}, master=${masterFormulaCounts[sheet]}`);
    }
  }
  const refs = refErrors(workbook);
  if (refs.length) failures.push(`REF errors: ${refs.join(', ')}`);
  const recalculatedViewState = workbookViewState(workbook);
  if (generatedViewState
      && (generatedViewState.activeSheet !== 'pro'
        || generatedViewState.proActiveCell !== 'A1'
        || generatedViewState.proTopLeftCell !== 'A1'
        || generatedTabSelectedSheets.length !== 1
        || generatedTabSelectedSheets[0] !== 'pro')) {
    failures.push(`generated workbook view is not pro at A1: ${JSON.stringify(generatedViewState)}`);
  }
  if (recalculatedViewState.activeSheet !== 'pro'
      || recalculatedViewState.proActiveCell !== 'A1'
      || recalculatedViewState.proTopLeftCell !== 'A1') {
    failures.push(`recalculated workbook view is not pro at A1: ${JSON.stringify(recalculatedViewState)}`);
  }
  const r14Freeze = r14.views?.[0] || {};
  if (r14Freeze.state !== 'frozen' || r14Freeze.xSplit !== 4 || r14Freeze.ySplit !== 6
      || r14Freeze.topLeftCell !== 'E7') {
    failures.push(`r14 freeze pane changed: ${JSON.stringify(r14Freeze)}`);
  }

  assertExact(failures, 'Glendale escrow Day linkage', actual.glendaleEscrowOpenDay, actual.escrowTabGlendaleOpenDay);
  assertExact(failures, 'Glendale escrow MTD linkage', actual.glendaleEscrowOpenMtd, actual.escrowTabGlendaleOpenMtd);
  if (calcPropertiesBeforeRecalculation
      && calcPropertiesBeforeRecalculation.fullCalcOnLoad !== true) {
    failures.push('generated workbook does not set fullCalcOnLoad');
  }

  const result = {
    pass: failures.length === 0,
    asOf,
    reportDate: expected.reportDate,
    calculationEngine: engine,
    workbook: workbookPath,
    actual,
    dashboard: expected,
    checks,
    ghosts,
    formulaCounts: calculatedFormulaCounts,
    masterFormulaCounts,
    refErrors: refs,
    generatedViewState,
    generatedTabSelectedSheets,
    recalculatedViewState,
    r14Freeze,
    calcPropertiesBeforeRecalculation,
    formulaCountsBefore: buildMetadata?.formulaCountsBefore || null,
    formulaCountsAfter: buildMetadata?.formulaCountsAfter || null,
    unroutedUnassignedBranches: buildMetadata?.unroutedUnassignedBranches || null,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length && !options.inspectOnly) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
