const ExcelJS = require('exceljs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', 'docs', 'templates', 'Daily_Report_Master.xlsx');
const REPAIR = process.argv.includes('--repair');
const SUMMARY = process.argv.includes('--summary');
const findings = [];

function rows(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function formulaOrValue(cell) {
  return cell.formula === undefined ? (cell.value ?? null) : cell.formula;
}

function setCanonical(sheet, address, canonical, valid = null) {
  const cell = sheet.getCell(address);
  if (valid ? valid(cell.formula) : cell.formula === canonical) return;
  findings.push({
    sheet: sheet.name,
    cell: address,
    current: formulaOrValue(cell),
    canonical,
  });
  if (REPAIR) cell.value = canonical === null ? null : { formula: canonical };
}

function formulaReferencesForRow(formula, row) {
  const references = new Set();
  const pattern = /(?:'[^']+'!)?\$?([A-Z]{1,3})\$?(\d+)/gi;
  let match;
  while ((match = pattern.exec(String(formula || ''))) !== null) {
    if (Number(match[2]) === row) references.add(match[1].toUpperCase());
  }
  return references;
}

function containsAllOwnRowReferences(formula, row, columns) {
  const compact = normalized(formula);
  return compact.includes(`SUM(${columns[0]}${row}:${columns.at(-1)}${row})`);
}

function isElapsedProjection(formula, row) {
  const compact = String(formula || '').replace(/\s+/g, '');
  return /IF\(\$?P\$?1=0,0,/i.test(compact)
    && new RegExp(`\\$?M\\$?${row}`, 'i').test(compact)
    && /\/\$?P\$?1/i.test(compact)
    && /\*\$?R\$?1/i.test(compact);
}

function normalized(formula) {
  return String(formula || '').replace(/\s+/g, '').replace(/\$/g, '').toUpperCase();
}

function formulaCellReferences(formula) {
  const references = new Set();
  const pattern = /(?:'[^']+'!)?\$?([A-Z]{1,3})\$?(\d+)/gi;
  let match;
  while ((match = pattern.exec(String(formula || ''))) !== null) {
    references.add(`${match[1].toUpperCase()}${Number(match[2])}`);
  }
  return references;
}

function referencesExactly(formula, expected) {
  const actual = formulaCellReferences(formula);
  return actual.size === expected.length && expected.every((reference) => actual.has(reference));
}

function expandedFormulaReferences(formula, column) {
  const references = new Set();
  const pattern = new RegExp(`\\$?${column}\\$?(\\d+)(?:\\s*:\\s*\\$?${column}\\$?(\\d+))?`, 'gi');
  let match;
  while ((match = pattern.exec(String(formula || ''))) !== null) {
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    for (let row = Math.min(start, end); row <= Math.max(start, end); row++) references.add(row);
  }
  return references;
}

function sameRows(actual, expected) {
  return actual.size === expected.length && expected.every((row) => actual.has(row));
}

function auditR14(sheet) {
  const slotRows = [...rows(9, 45), ...rows(49, 83), ...rows(87, 101)];
  const totals = {
    H: ['E', 'F', 'G'],
    M: ['J', 'K', 'L'],
    T: ['Q', 'R', 'S'],
    Y: ['V', 'W', 'X'],
    AE: ['AB', 'AC', 'AD'],
    AK: ['AH', 'AI', 'AJ'],
  };
  for (const row of slotRows) {
    for (const [column, components] of Object.entries(totals)) {
      setCanonical(
        sheet,
        `${column}${row}`,
        `SUM(${components[0]}${row}:${components.at(-1)}${row})`,
        (formula) => containsAllOwnRowReferences(formula, row, components)
      );
    }
    setCanonical(
      sheet,
      `N${row}`,
      `IF($P$1=0,0,+M${row}/$P$1*$R$1)`,
      (formula) => isElapsedProjection(formula, row)
    );
  }

  for (const column of ['E','F','G','H','J','K','L','M','N','Q','R','S','T','V','W','X','Y','AB','AC','AD','AE','AH','AI','AJ','AK']) {
    setCanonical(sheet, `${column}46`, `SUM(${column}9:${column}45)`);
    setCanonical(sheet, `${column}102`, `SUM(${column}87:${column}101)`);
    setCanonical(sheet, `${column}104`, `SUM(${column}102,${column}84,${column}46)`);
  }

  const orangeSubtotal = {
    E: 'SUM(E49:E83)-E51',
    F: 'SUM(F49:F83)-F51',
    G: 'SUM(G49:G83)-G53-G64',
    H: 'SUM(H49:H83)',
    J: 'SUM(J49:J83)-J51',
    K: 'SUM(K49:K83)-K51',
    L: 'SUM(L49:L83)-L53-L64',
    M: 'SUM(M49:M83)',
    N: 'SUM(N49:N83)',
    Q: 'SUM(Q49:Q83)-Q51',
    R: 'SUM(R49:R83)-R51',
    S: 'SUM(S49:S83)-S53-S64',
    T: 'SUM(T49:T83)',
    V: 'SUM(V49:V83)-V51',
    W: 'SUM(W49:W83)-W51',
    X: 'SUM(X49:X83)-X53-X64',
    Y: 'SUM(Y49:Y83)',
    AB: 'SUM(AB49:AB83)-AB51',
    AC: 'SUM(AC49:AC83)-AC51',
    AD: 'SUM(AD49:AD83)-AD53-AD64',
    AE: 'SUM(AE49:AE83)',
    AH: 'SUM(AH49:AH83)-AH51',
    AI: 'SUM(AI49:AI83)-AI51',
    AJ: 'SUM(AJ49:AJ83)-AJ53-AJ64',
    AK: 'SUM(AK49:AK83)',
  };
  for (const [column, formula] of Object.entries(orangeSubtotal)) {
    setCanonical(sheet, `${column}84`, formula);
  }
}

function auditEscrow(sheet) {
  const metricColumns = ['D','E','F','H','I','J','L','M','N'];
  const totals = [
    [14, rows(8, 13)],
    [25, [20,21,23,24]],
    [46, [44,45]],
    [48, [20,21,23,24,28,29,31,32,34,35,39,40,44,45]],
    [57, [55,56]],
    [61, [59,60]],
    [72, [52,53,55,56,59,60,64,65,67,68,70,71]],
    [90, [76,77,79,80,82,83,85,86,88,89]],
    [107, [93,94,96,97,99,100,102,103,105,106]],
    [108, [93,94,96,97,99,100,102,103,105,106]],
  ];
  for (const [totalRow, detailRows] of totals) {
    for (const column of metricColumns) {
      const groups = [];
      for (const row of detailRows) {
        const previous = groups.at(-1);
        if (previous && previous[1] === row - 1) previous[1] = row;
        else groups.push([row, row]);
      }
      const canonical = `SUM(${groups.map(([start, end]) =>
        start === end ? `${column}${start}` : `${column}${start}:${column}${end}`).join(',')})`;
      setCanonical(
        sheet,
        `${column}${totalRow}`,
        canonical,
        (formula) => sameRows(expandedFormulaReferences(formula, column), detailRows)
      );
    }
  }
  for (const column of metricColumns) {
    const detailRows = [48,72,90,107];
    setCanonical(
      sheet,
      `${column}109`,
      `SUM(${detailRows.map((row) => `${column}${row}`).join(',')})`,
      (formula) => sameRows(expandedFormulaReferences(formula, column), detailRows)
    );
  }
  setCanonical(sheet, 'M42', null, (formula) => formula === undefined && sheet.getCell('M42').value == null);
  setCanonical(sheet, 'N42', null, (formula) => formula === undefined && sheet.getCell('N42').value == null);
}

function isGuardedAverage(formula, row, sourceColumn) {
  const compact = normalized(formula);
  return compact.includes('IF(O1=0,0,')
    && compact.includes(`${sourceColumn}${row}/O1`)
    && referencesExactly(formula, [`${sourceColumn}${row}`, 'O1']);
}

function isGuardedProjection(formula, row, sourceColumn = 'M') {
  const compact = normalized(formula);
  return compact.includes('IF(O1=0,0,')
    && compact.includes(`${sourceColumn}${row}`)
    && compact.includes('Q1')
    && referencesExactly(formula, [`${sourceColumn}${row}`, 'O1', 'Q1']);
}

function isGuardedRatio(formula, row) {
  const compact = normalized(formula);
  return compact.includes(`IF(Y${row}=0,0,`);
}

function auditPro(sheet) {
  const averageRows = [6,...rows(8,13),17,18,19,22,23,26,27,30,31,32,35,36,37,38,41,44,48,49,50];
  for (const row of averageRows) {
    setCanonical(sheet, `G${row}`, `IF($O$1=0,0,+F${row}/$O$1)`,
      (formula) => isGuardedAverage(formula, row, 'F'));
    setCanonical(sheet, `H${row}`, `IF($O$1=0,0,+G${row}*$Q$1)`,
      (formula) => isGuardedProjection(formula, row, 'G'));
    setCanonical(sheet, `M${row}`, `IF($O$1=0,0,+L${row}/$O$1)`,
      (formula) => isGuardedAverage(formula, row, 'L'));
    setCanonical(sheet, `N${row}`, `IF($O$1=0,0,+M${row}*$Q$1)`,
      (formula) => isGuardedProjection(formula, row));
    setCanonical(sheet, `S${row}`, `IF($O$1=0,0,+R${row}/$O$1*$Q$1)`,
      (formula) => {
        const compact = normalized(formula);
        return compact.includes('IF(O1=0,0,')
          && compact.includes(`R${row}/O1`)
          && compact.includes('Q1')
          && referencesExactly(formula, [`R${row}`, 'O1', 'Q1']);
      });
    setCanonical(sheet, `W${row}`, `IF(L${row}=0,0,+R${row}/L${row})`,
      (formula) => {
        const compact = normalized(formula);
        return compact.includes(`IF(L${row}=0,0,`)
          && compact.includes(`R${row}/L${row}`);
      });
  }

  setCanonical(sheet, 'W47', 'IF(L47=0,0,+R47/L47)', (formula) => {
    const compact = normalized(formula);
    return compact.includes('IF(L47=0,0,') && compact.includes('R47/L47');
  });
  setCanonical(sheet, 'K27', "'r14'!$R$102");
  setCanonical(sheet, 'K36', "'r14'!$R$106");

  for (let row = 1; row <= 60; row++) {
    for (const column of ['Z', 'AA']) {
      const cell = sheet.getCell(`${column}${row}`);
      if (cell.formula === undefined || !normalized(cell.formula).includes(`/Y${row}`)) continue;
      if (isGuardedRatio(cell.formula, row)) continue;
      setCanonical(
        sheet,
        `${column}${row}`,
        `IF(Y${row}=0,0,${cell.formula})`
      );
    }
  }
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  auditR14(workbook.getWorksheet('r14'));
  auditEscrow(workbook.getWorksheet('Escrow'));
  auditPro(workbook.getWorksheet('pro'));

  if (REPAIR && findings.length) await workbook.xlsx.writeFile(TEMPLATE_PATH);
  const bySheet = Object.fromEntries(['pro', 'r14', 'Escrow'].map((sheetName) => [
    sheetName,
    findings.filter(({ sheet }) => sheet === sheetName).length,
  ]));
  const report = {
    template: TEMPLATE_PATH,
    repair: REPAIR,
    slotsAudited: { pro: 27, r14: 87, Escrow: 50 },
    findings: findings.length,
    bySheet,
    changes: findings,
  };
  console.log(JSON.stringify(SUMMARY ? {
    repair: report.repair,
    slotsAudited: report.slotsAudited,
    findings: report.findings,
    bySheet: report.bySheet,
  } : report, null, 2));
  if (!REPAIR && findings.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
