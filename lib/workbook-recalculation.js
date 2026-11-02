const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');

const FORMULA_ERROR_CODES = [
  '#DIV/0!',
  '#REF!',
  '#VALUE!',
  '#N/A',
  '#NAME?',
  '#NUM!',
  '#NULL!',
];

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`
    );
  }
}

function commandWorks(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
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
  if (!fs.existsSync(output)) {
    throw new Error('LibreOffice did not produce a recalculated workbook');
  }
  fs.copyFileSync(output, workbookPath);
}

function recalculateWorkbookFile(workbookPath) {
  if (process.platform === 'win32') {
    const script = path.join(__dirname, '..', 'scripts', 'recalculate-daily-excel.ps1');
    run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-WorkbookPath',
      workbookPath,
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
    'No spreadsheet calculation engine found. Delivery stopped rather than reading cached formula results.'
  );
}

async function recalculateWorkbookBuffer(buffer) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pct-daily-excel-'));
  const workbookPath = path.join(tempDir, 'daily.xlsx');
  try {
    fs.writeFileSync(workbookPath, buffer);
    const engine = recalculateWorkbookFile(workbookPath);
    const recalculated = fs.readFileSync(workbookPath);
    return { buffer: recalculated, engine };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function formulaErrorCode(cell) {
  const serialized = JSON.stringify({
    formula: cell.formula,
    result: cell.result,
    value: cell.value,
  }).toUpperCase();
  return FORMULA_ERROR_CODES.find((code) => serialized.includes(code)) || null;
}

function scanFormulaErrors(workbook, sheetNames = ['pro', 'Escrow', 'r14']) {
  const errors = [];
  for (const sheetName of sheetNames) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      errors.push({ sheet: sheetName, address: '(missing)', error: '#REF!' });
      continue;
    }
    sheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const error = formulaErrorCode(cell);
        if (error) errors.push({ sheet: sheetName, address: cell.address, error });
      });
    });
  }
  return errors;
}

async function loadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

module.exports = {
  FORMULA_ERROR_CODES,
  loadWorkbook,
  recalculateWorkbookBuffer,
  recalculateWorkbookFile,
  scanFormulaErrors,
};
