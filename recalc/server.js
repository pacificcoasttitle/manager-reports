const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const express = require('express');

const PORT = Number(process.env.PORT) || 8080;
const SOFFICE = process.env.SOFFICE_BIN || 'soffice';
const RECALC_TIMEOUT_MS = 90000;
const FORMULA_ERRORS = [
  '#DIV/0!',
  '#REF!',
  '#VALUE!',
  '#N/A',
  '#NAME?',
  '#NUM!',
];

const app = express();
const rawWorkbook = express.raw({
  type: () => true,
  limit: '50mb',
});

class CommandError extends Error {
  constructor(message, stderr = '') {
    super(message);
    this.stderr = stderr;
  }
}

function commandText(value) {
  return Buffer.isBuffer(value) ? value.toString('utf8').trim() : String(value || '').trim();
}

function runCommand(command, args, timeout = RECALC_TIMEOUT_MS) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    timeout,
  });
  const stderr = commandText(result.stderr);
  if (result.error?.code === 'ETIMEDOUT') {
    throw new CommandError(`${command} timed out after ${timeout}ms`, stderr);
  }
  if (result.error) {
    throw new CommandError(`${command} failed: ${result.error.message}`, stderr);
  }
  if (result.status !== 0) {
    throw new CommandError(`${command} exited with status ${result.status}`, stderr);
  }
  return {
    stdout: commandText(result.stdout),
    stderr,
  };
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attributes(source) {
  const result = {};
  const pattern = /([:\w-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    result[match[1]] = decodeXml(match[2]);
  }
  return result;
}

function readZipEntry(workbookPath, entry) {
  return runCommand('unzip', ['-p', workbookPath, entry], 30000).stdout;
}

function workbookSheets(workbookPath) {
  const workbookXml = readZipEntry(workbookPath, 'xl/workbook.xml');
  const relationshipsXml = readZipEntry(workbookPath, 'xl/_rels/workbook.xml.rels');
  const targets = new Map();
  let match;

  const relationshipPattern = /<Relationship\b([^>]*)\/?>/g;
  while ((match = relationshipPattern.exec(relationshipsXml)) !== null) {
    const attrs = attributes(match[1]);
    if (attrs.Id && attrs.Target) targets.set(attrs.Id, attrs.Target);
  }

  const sheets = [];
  const sheetPattern = /<sheet\b([^>]*)\/?>/g;
  while ((match = sheetPattern.exec(workbookXml)) !== null) {
    const attrs = attributes(match[1]);
    const target = targets.get(attrs['r:id']);
    if (!target) continue;
    const entry = target.startsWith('/')
      ? target.slice(1)
      : path.posix.normalize(path.posix.join('xl', target));
    if (!entry.startsWith('xl/') || entry.split('/').includes('..')) {
      throw new Error(`Unsafe worksheet path: ${target}`);
    }
    sheets.push({ name: attrs.name || '(unnamed)', entry });
  }
  return sheets;
}

function formulaErrors(workbookPath) {
  const errors = [];
  for (const sheet of workbookSheets(workbookPath)) {
    const sheetXml = readZipEntry(workbookPath, sheet.entry);
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let match;
    while ((match = cellPattern.exec(sheetXml)) !== null) {
      const attrs = attributes(match[1]);
      const body = match[2];
      const valueMatch = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
      const textMatch = body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
      const formulaMatch = body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/);
      const value = decodeXml(valueMatch?.[1] ?? textMatch?.[1] ?? '').trim();
      const formula = decodeXml(formulaMatch?.[1] ?? '').toUpperCase();
      const error = FORMULA_ERRORS.find((code) =>
        value.toUpperCase() === code || formula.includes(code)
      );
      if (error) {
        errors.push({
          sheet: sheet.name,
          cell: attrs.r || '(unknown)',
          value: value || error,
        });
      }
    }
  }
  return errors;
}

function validKey(candidate) {
  const expected = process.env.RECALC_KEY;
  if (!expected || typeof candidate !== 'string') return false;
  const actualBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireRecalcKey(req, res, next) {
  if (!process.env.RECALC_KEY) {
    return res.status(500).json({ error: 'RECALC_KEY is not configured' });
  }
  if (!validKey(req.get('x-recalc-key'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function sofficeVersion() {
  const result = runCommand(SOFFICE, ['--headless', '--version'], 10000);
  return result.stdout || result.stderr;
}

app.get('/health', (req, res) => {
  try {
    res.json({ ok: true, soffice: sofficeVersion() });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      stderr: error.stderr || '',
    });
  }
});

app.post('/recalc', requireRecalcKey, rawWorkbook, (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Request body must contain .xlsx bytes' });
  }
  if (req.body[0] !== 0x50 || req.body[1] !== 0x4b) {
    return res.status(400).json({ error: 'Request body is not an .xlsx file' });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-recalc-'));
  try {
    const inputDir = path.join(tempDir, 'input');
    const outputDir = path.join(tempDir, 'output');
    const profileDir = path.join(tempDir, 'profile');
    fs.mkdirSync(inputDir);
    fs.mkdirSync(outputDir);
    fs.mkdirSync(profileDir);

    const inputPath = path.join(inputDir, 'workbook.xlsx');
    const outputPath = path.join(outputDir, 'workbook.xlsx');
    fs.writeFileSync(inputPath, req.body);

    runCommand(SOFFICE, [
      '--headless',
      '--nologo',
      '--nodefault',
      '--nolockcheck',
      '--nofirststartwizard',
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--convert-to',
      'xlsx',
      '--outdir',
      outputDir,
      inputPath,
    ]);

    if (!fs.existsSync(outputPath)) {
      throw new CommandError('soffice did not produce a recalculated workbook');
    }
    const recalculated = fs.readFileSync(outputPath);
    return res.json({
      errors: formulaErrors(outputPath),
      file: recalculated.toString('base64'),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || String(error),
      stderr: error.stderr || '',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Workbook exceeds 50 MB' });
  }
  return next(error);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`excel-recalc listening on port ${PORT}`);
  });
}

module.exports = {
  app,
  formulaErrors,
  workbookSheets,
};
