const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const pool = require('../database/pool');
const { buildDailyExcel } = require('../lib/daily-excel');

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
  const [openResult, closeResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE received_date::date = $2::date
            AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title only', 'title & escrow')
        )::int AS title_day,
        COUNT(*) FILTER (
          WHERE received_date::date <= $2::date
            AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title only', 'title & escrow')
        )::int AS title_mtd,
        COUNT(*) FILTER (
          WHERE received_date::date = $2::date
            AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title & escrow', 'escrow only')
        )::int AS escrow_day,
        COUNT(*) FILTER (
          WHERE received_date::date <= $2::date
            AND LOWER(TRIM(COALESCE(order_type, ''))) IN ('title & escrow', 'escrow only')
        )::int AS escrow_mtd
      FROM open_orders
      WHERE open_month = $1
        AND file_number NOT ILIKE 'test%'
        AND file_number NOT ILIKE 'ar test%'
        AND (profile NOT ILIKE '%test & training%' OR profile IS NULL)
    `, [month, reportDate]),
    pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE transaction_date::date = $2::date
            AND COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) > 0
        )::int AS title_day,
        COUNT(*) FILTER (
          WHERE transaction_date::date <= $2::date
            AND COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) > 0
        )::int AS title_mtd,
        COUNT(*) FILTER (
          WHERE transaction_date::date = $2::date AND COALESCE(escrow_revenue, 0) > 0
        )::int AS escrow_day,
        COUNT(*) FILTER (
          WHERE transaction_date::date <= $2::date AND COALESCE(escrow_revenue, 0) > 0
        )::int AS escrow_mtd,
        ROUND(SUM(
          CASE WHEN transaction_date::date = $2::date
            THEN COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) ELSE 0 END
        )::numeric, 2) AS title_revenue_day,
        ROUND(SUM(
          CASE WHEN transaction_date::date <= $2::date
            THEN COALESCE(title_revenue, 0) + COALESCE(underwriter_revenue, 0) ELSE 0 END
        )::numeric, 2) AS title_revenue_mtd,
        ROUND(SUM(
          CASE WHEN transaction_date::date = $2::date THEN COALESCE(tsg_revenue, 0) ELSE 0 END
        )::numeric, 2) AS tsg_revenue_day,
        ROUND(SUM(
          CASE WHEN transaction_date::date <= $2::date THEN COALESCE(tsg_revenue, 0) ELSE 0 END
        )::numeric, 2) AS tsg_revenue_mtd,
        ROUND(SUM(
          CASE WHEN transaction_date::date = $2::date THEN COALESCE(total_revenue, 0) ELSE 0 END
        )::numeric, 2) AS total_revenue_day,
        ROUND(SUM(
          CASE WHEN transaction_date::date <= $2::date THEN COALESCE(total_revenue, 0) ELSE 0 END
        )::numeric, 2) AS total_revenue_mtd
      FROM order_summary
      WHERE fetch_month = $1 AND transaction_date IS NOT NULL
    `, [month, reportDate]),
  ]);
  return {
    reportDate,
    titleOpenDay: number(openResult.rows[0].title_day),
    titleOpenMtd: number(openResult.rows[0].title_mtd),
    escrowOpenDay: number(openResult.rows[0].escrow_day),
    escrowOpenMtd: number(openResult.rows[0].escrow_mtd),
    titleCloseDay: number(closeResult.rows[0].title_day),
    titleCloseMtd: number(closeResult.rows[0].title_mtd),
    escrowCloseDay: number(closeResult.rows[0].escrow_day),
    escrowCloseMtd: number(closeResult.rows[0].escrow_mtd),
    titleRevenueDay: number(closeResult.rows[0].title_revenue_day),
    titleRevenueMtd: number(closeResult.rows[0].title_revenue_mtd),
    tsgRevenueDay: number(closeResult.rows[0].tsg_revenue_day),
    tsgRevenueMtd: number(closeResult.rows[0].tsg_revenue_mtd),
    totalRevenueDay: number(closeResult.rows[0].total_revenue_day),
    totalRevenueMtd: number(closeResult.rows[0].total_revenue_mtd),
  };
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
    failures.push(`${name}: workbook=${actual}, dashboard=${expected}`);
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
    fs.writeFileSync(workbookPath, buffer);
  }

  const engine = recalculate(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const pro = workbook.getWorksheet('pro');
  const escrow = workbook.getWorksheet('Escrow');

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
    tsgRevenueDay: cellNumber(pro, 'Q50'),
    tsgRevenueMtd: cellNumber(pro, 'R50'),
    totalRevenueDay: cellNumber(pro, 'Q53'),
    totalRevenueMtd: cellNumber(pro, 'R53'),
  };
  const expected = await dashboardExpected(asOf);
  const ghosts = findGhostInputs(workbook);
  const failures = [];

  assertExact(failures, 'Glendale escrow Day linkage', actual.glendaleEscrowOpenDay, actual.escrowTabGlendaleOpenDay);
  assertExact(failures, 'Glendale escrow MTD linkage', actual.glendaleEscrowOpenMtd, actual.escrowTabGlendaleOpenMtd);
  for (const key of [
    'titleOpenDay','titleOpenMtd','titleCloseDay','titleCloseMtd',
    'titleRevenueDay','titleRevenueMtd',
    'escrowOpenDay','escrowOpenMtd','escrowCloseDay','escrowCloseMtd',
    'tsgRevenueDay','tsgRevenueMtd','totalRevenueDay','totalRevenueMtd',
  ]) assertExact(failures, key, actual[key], expected[key]);
  if (ghosts.length) failures.push(`ghost inputs: ${ghosts.join(', ')}`);
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
    ghosts,
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
