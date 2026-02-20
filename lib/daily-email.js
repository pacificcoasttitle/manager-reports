/**
 * Daily email report — Revenue + Opens for CEO/management
 * Sends via SendGrid every morning after the nightly cron import.
 *
 * Environment variables:
 *   SENDGRID_API_KEY       — SendGrid API key
 *   DAILY_REPORT_FROM      — From address (e.g. jerry@pacificcoasttitle.com)
 *
 * Recipients stored in app_settings:
 *   key: 'daily_report_recipients'  value: 'ceo@pct.com,gm@pct.com'
 *   key: 'daily_email_enabled'      value: 'true'
 */

const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');

// ============================================
// HELPERS
// ============================================
const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BRANCHES = ['Glendale', 'Orange', 'TSG'];
const CATEGORIES = ['Purchase', 'Refinance', 'Escrow', 'TSG'];

function fmt(n) {
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtFull(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function pctChange(current, prev) {
  if (!prev || prev === 0) return { text: '—', color: '#868e96' };
  const pct = ((current - prev) / prev * 100).toFixed(1);
  const up = parseFloat(pct) >= 0;
  return {
    text: (up ? '▲ ' : '▼ ') + Math.abs(parseFloat(pct)) + '%',
    color: up ? '#2f9e44' : '#e03131'
  };
}

function cell(content, extraStyle = '') {
  return `<td align="center" style="padding:6px 8px; border-bottom:1px solid #f1f3f5; ${extraStyle}">${content}</td>`;
}

// ============================================
// BUILD HTML REPORT
// ============================================
async function buildDailyReportHtml(overrideDate) {
  // "Yesterday" in Pacific time (or override for testing)
  const nowPacific = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  let yesterday;
  if (overrideDate) {
    yesterday = new Date(overrideDate + 'T12:00:00');
  } else {
    yesterday = new Date(nowPacific);
    yesterday.setDate(yesterday.getDate() - 1);
  }

  const year = yesterday.getFullYear();
  const month = yesterday.getMonth() + 1;
  const day = yesterday.getDate();
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const yesterdayStr = `${yearMonth}-${String(day).padStart(2, '0')}`;
  const priorMonth = month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;

  // Load officer → branch map
  const { rows: officerRows } = await pool.query(
    'SELECT officer_name, branch FROM title_officer_branches WHERE is_active = true'
  );
  const officerBranchMap = {};
  officerRows.forEach(r => { officerBranchMap[r.officer_name] = r.branch; });

  function getBranch(titleOfficer) {
    return officerBranchMap[titleOfficer] || 'Unassigned';
  }

  // ---- QUERIES ----
  const [
    { rows: ydayCloseRows },
    { rows: ydayOpenRows },
    { rows: mtdCloseRows },
    { rows: mtdOpenRows },
    { rows: priorCloseRows },
    { rows: topRepsRows },
    { rows: workDaysRows }
  ] = await Promise.all([
    pool.query(`
      SELECT title_officer, category, COUNT(*) as cnt,
             ROUND(SUM(total_revenue)::numeric,2) as revenue
      FROM order_summary WHERE transaction_date = $1
      GROUP BY title_officer, category
    `, [yesterdayStr]),

    pool.query(`
      SELECT title_officer, category, COUNT(*) as cnt
      FROM open_orders WHERE received_date = $1
      GROUP BY title_officer, category
    `, [yesterdayStr]),

    pool.query(`
      SELECT title_officer, COUNT(*) as cnt,
             ROUND(SUM(total_revenue)::numeric,2) as revenue
      FROM order_summary WHERE fetch_month = $1
      GROUP BY title_officer
    `, [yearMonth]),

    pool.query(`
      SELECT title_officer, COUNT(*) as cnt
      FROM open_orders WHERE open_month = $1
      GROUP BY title_officer
    `, [yearMonth]),

    pool.query(`
      SELECT title_officer, ROUND(SUM(total_revenue)::numeric,2) as revenue
      FROM order_summary WHERE fetch_month = $1
      GROUP BY title_officer
    `, [priorMonth]),

    pool.query(`
      SELECT sales_rep, ROUND(SUM(total_revenue)::numeric,2) as revenue
      FROM order_summary
      WHERE fetch_month = $1 AND sales_rep IS NOT NULL AND sales_rep != ''
      GROUP BY sales_rep ORDER BY revenue DESC LIMIT 5
    `, [yearMonth]),

    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE d <= $2::date) as worked,
        COUNT(*) as total
      FROM generate_series(
        $1::date,
        (date_trunc('month', $1::date) + interval '1 month - 1 day')::date,
        '1 day'
      ) d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    `, [`${yearMonth}-01`, yesterdayStr])
  ]);

  const workedDays = parseInt(workDaysRows[0]?.worked || 0);
  const totalDays = parseInt(workDaysRows[0]?.total || 22);
  const remainingDays = totalDays - workedDays;

  // ---- AGGREGATE BY BRANCH ----
  // Yesterday closings
  const ydayClose = {};
  BRANCHES.forEach(b => {
    ydayClose[b] = { total: { cnt: 0, rev: 0 } };
    CATEGORIES.forEach(c => { ydayClose[b][c] = { cnt: 0, rev: 0 }; });
  });
  ydayCloseRows.forEach(r => {
    const b = getBranch(r.title_officer);
    if (!ydayClose[b]) return;
    const cat = r.category;
    const cnt = parseInt(r.cnt); const rev = parseFloat(r.revenue);
    if (ydayClose[b][cat]) { ydayClose[b][cat].cnt += cnt; ydayClose[b][cat].rev += rev; }
    ydayClose[b].total.cnt += cnt; ydayClose[b].total.rev += rev;
  });

  // Yesterday openings
  const ydayOpen = {};
  BRANCHES.forEach(b => {
    ydayOpen[b] = { total: 0 };
    CATEGORIES.forEach(c => { ydayOpen[b][c] = 0; });
  });
  ydayOpenRows.forEach(r => {
    const b = getBranch(r.title_officer);
    if (!ydayOpen[b]) return;
    const cnt = parseInt(r.cnt);
    if (ydayOpen[b][r.category] !== undefined) ydayOpen[b][r.category] += cnt;
    ydayOpen[b].total += cnt;
  });

  // MTD
  const mtd = {};
  BRANCHES.forEach(b => { mtd[b] = { opens: 0, closed: 0, revenue: 0 }; });
  mtdCloseRows.forEach(r => {
    const b = getBranch(r.title_officer);
    if (!mtd[b]) return;
    mtd[b].closed += parseInt(r.cnt);
    mtd[b].revenue += parseFloat(r.revenue);
  });
  mtdOpenRows.forEach(r => {
    const b = getBranch(r.title_officer);
    if (!mtd[b]) return;
    mtd[b].opens += parseInt(r.cnt);
  });

  // Prior month
  const prior = {};
  BRANCHES.forEach(b => { prior[b] = 0; });
  priorCloseRows.forEach(r => {
    const b = getBranch(r.title_officer);
    if (prior[b] !== undefined) prior[b] += parseFloat(r.revenue);
  });

  // Totals
  const totals = { ydClose: { cnt: 0, rev: 0 }, ydOpen: 0, mtdOpens: 0, mtdClosed: 0, mtdRevenue: 0, priorRevenue: 0 };
  BRANCHES.forEach(b => {
    totals.ydClose.cnt += ydayClose[b].total.cnt;
    totals.ydClose.rev += ydayClose[b].total.rev;
    totals.ydOpen += ydayOpen[b].total;
    totals.mtdOpens += mtd[b].opens;
    totals.mtdClosed += mtd[b].closed;
    totals.mtdRevenue += mtd[b].revenue;
    totals.priorRevenue += prior[b];
  });

  const projectedTotal = workedDays > 0 ? (totals.mtdRevenue / workedDays) * totalDays : 0;
  const reportDate = `${dayNames[yesterday.getDay()]}, ${monthNames[month]} ${day}, ${year}`;
  const mtdRange = `${monthNames[month]} 1–${day}`;
  const priorMonthName = monthNames[month === 1 ? 12 : month - 1];

  // ---- TABLE HELPERS ----
  const thStyle = 'padding:8px 8px; font-weight:600; color:#495057; border-bottom:2px solid #dee2e6; font-size:12px;';
  const totalThStyle = 'padding:8px 8px; font-weight:700; color:#03374f; border-bottom:2px solid #dee2e6; font-size:12px;';

  const branchHeaders = BRANCHES.map(b =>
    `<td align="center" style="${thStyle}">${b}</td>`
  ).join('') + `<td align="center" style="${totalThStyle}">Total</td>`;

  // ---- BUILD HTML ----
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PCT Daily Report</title>
</head>
<body style="margin:0; padding:0; background-color:#f0f2f5; font-family:Arial, Helvetica, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;">
<tr><td align="center" style="padding:24px 12px;">

<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.10);">

  <!-- HEADER -->
  <tr>
    <td style="background:linear-gradient(135deg,#03374f 0%,#055a7e 100%); padding:26px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:11px; font-weight:600; color:#8db4d4; letter-spacing:2px; text-transform:uppercase;">Pacific Coast Title</div>
            <div style="font-size:22px; font-weight:700; color:#ffffff; margin-top:4px; letter-spacing:-0.3px;">Daily Production Report</div>
          </td>
          <td align="right" valign="middle">
            <div style="font-size:12px; color:#8db4d4; white-space:nowrap;">${reportDate}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- SUMMARY PILLS -->
  <tr>
    <td style="background-color:#f8f9fa; padding:16px 32px; border-bottom:1px solid #e9ecef;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding:0 8px;">
            <div style="font-size:10px; color:#868e96; font-weight:600; text-transform:uppercase; letter-spacing:0.8px;">Yesterday Closed</div>
            <div style="font-size:24px; font-weight:700; color:#03374f; margin-top:2px;">${totals.ydClose.cnt}</div>
            <div style="font-size:11px; color:#868e96;">${fmtFull(totals.ydClose.rev)}</div>
          </td>
          <td style="width:1px; background:#dee2e6;"></td>
          <td align="center" style="padding:0 8px;">
            <div style="font-size:10px; color:#868e96; font-weight:600; text-transform:uppercase; letter-spacing:0.8px;">Yesterday Opened</div>
            <div style="font-size:24px; font-weight:700; color:#03374f; margin-top:2px;">${totals.ydOpen}</div>
            <div style="font-size:11px; color:#868e96;">&nbsp;</div>
          </td>
          <td style="width:1px; background:#dee2e6;"></td>
          <td align="center" style="padding:0 8px;">
            <div style="font-size:10px; color:#868e96; font-weight:600; text-transform:uppercase; letter-spacing:0.8px;">MTD Revenue</div>
            <div style="font-size:24px; font-weight:700; color:#f26b2b; margin-top:2px;">${fmt(totals.mtdRevenue)}</div>
            <div style="font-size:11px; color:#868e96;">${workedDays} of ${totalDays} days</div>
          </td>
          <td style="width:1px; background:#dee2e6;"></td>
          <td align="center" style="padding:0 8px;">
            <div style="font-size:10px; color:#868e96; font-weight:600; text-transform:uppercase; letter-spacing:0.8px;">Projected</div>
            <div style="font-size:24px; font-weight:700; color:#03374f; margin-top:2px;">${fmt(projectedTotal)}</div>
            <div style="font-size:11px; color:#868e96;">${remainingDays} days left</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- YESTERDAY CLOSINGS -->
  <tr>
    <td style="padding:24px 32px 0;">
      <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">Yesterday's Closings</div>
      <div style="font-size:11px; color:#868e96; margin-bottom:10px;">${monthNames[month]} ${day}, ${year}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px; border-collapse:collapse;">
        <tr style="background-color:#f8f9fa;">
          <td style="${thStyle} text-align:left; width:90px;"></td>
          ${branchHeaders}
        </tr>
        ${CATEGORIES.map(cat => {
          const catTotal = BRANCHES.reduce((s, b) => s + (ydayClose[b][cat]?.cnt || 0), 0);
          return `<tr>
            <td style="padding:6px 8px; color:#495057; border-bottom:1px solid #f1f3f5;">${cat}</td>
            ${BRANCHES.map(b => cell(ydayClose[b][cat]?.cnt || '—')).join('')}
            ${cell(catTotal || '—', 'font-weight:600;')}
          </tr>`;
        }).join('')}
        <tr style="background-color:#fff8f0;">
          <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6; font-size:12px;">Revenue</td>
          ${BRANCHES.map(b => `<td align="center" style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">${fmtFull(ydayClose[b].total.rev)}</td>`).join('')}
          <td align="center" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmtFull(totals.ydClose.rev)}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- YESTERDAY OPENINGS -->
  <tr>
    <td style="padding:20px 32px 0;">
      <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">Yesterday's Openings</div>
      <div style="font-size:11px; color:#868e96; margin-bottom:10px;">${monthNames[month]} ${day}, ${year}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px; border-collapse:collapse;">
        <tr style="background-color:#f8f9fa;">
          <td style="${thStyle} text-align:left; width:90px;"></td>
          ${branchHeaders}
        </tr>
        ${CATEGORIES.map(cat => {
          const catTotal = BRANCHES.reduce((s, b) => s + (ydayOpen[b][cat] || 0), 0);
          return `<tr>
            <td style="padding:6px 8px; color:#495057; border-bottom:1px solid #f1f3f5;">${cat}</td>
            ${BRANCHES.map(b => cell(ydayOpen[b][cat] || '—')).join('')}
            ${cell(catTotal || '—', 'font-weight:600;')}
          </tr>`;
        }).join('')}
        <tr style="background-color:#f8f9fa;">
          <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6; font-size:12px;">Total</td>
          ${BRANCHES.map(b => `<td align="center" style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">${ydayOpen[b].total}</td>`).join('')}
          <td align="center" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${totals.ydOpen}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- MONTH-TO-DATE -->
  <tr>
    <td style="padding:20px 32px 0;">
      <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">Month-to-Date</div>
      <div style="font-size:11px; color:#868e96; margin-bottom:10px;">${mtdRange} &nbsp;•&nbsp; ${workedDays} of ${totalDays} working days &nbsp;•&nbsp; ${remainingDays} days remaining</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px; border-collapse:collapse;">
        <tr style="background-color:#f8f9fa;">
          <td style="${thStyle} text-align:left; width:90px;"></td>
          ${branchHeaders}
        </tr>
        <tr>
          <td style="padding:6px 8px; color:#495057; border-bottom:1px solid #f1f3f5;">Opens</td>
          ${BRANCHES.map(b => cell(mtd[b].opens.toLocaleString())).join('')}
          ${cell(totals.mtdOpens.toLocaleString(), 'font-weight:600;')}
        </tr>
        <tr>
          <td style="padding:6px 8px; color:#495057; border-bottom:1px solid #f1f3f5;">Closed</td>
          ${BRANCHES.map(b => cell(mtd[b].closed.toLocaleString())).join('')}
          ${cell(totals.mtdClosed.toLocaleString(), 'font-weight:600;')}
        </tr>
        <tr style="background-color:#fff8f0;">
          <td style="padding:9px 8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5; border-top:2px solid #dee2e6;">Revenue</td>
          ${BRANCHES.map(b => `<td align="center" style="padding:9px 8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5; border-top:2px solid #dee2e6;">${fmt(mtd[b].revenue)}</td>`).join('')}
          <td align="center" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-bottom:1px solid #f1f3f5; border-top:2px solid #dee2e6;">${fmt(totals.mtdRevenue)}</td>
        </tr>
        <tr>
          <td style="padding:6px 8px; color:#868e96; border-bottom:1px solid #f1f3f5; font-size:11px;">${priorMonthName}</td>
          ${BRANCHES.map(b => cell(fmt(prior[b]), 'color:#868e96; font-size:11px;')).join('')}
          ${cell(fmt(totals.priorRevenue), 'color:#868e96; font-size:11px; font-weight:600;')}
        </tr>
        <tr>
          <td style="padding:6px 8px; color:#868e96; border-bottom:1px solid #f1f3f5; font-size:11px;">vs Last Month</td>
          ${BRANCHES.map(b => {
            const c = pctChange(mtd[b].revenue, prior[b]);
            return `<td align="center" style="padding:6px 8px; color:${c.color}; font-weight:600; border-bottom:1px solid #f1f3f5; font-size:11px;">${c.text}</td>`;
          }).join('')}
          ${(() => {
            const c = pctChange(totals.mtdRevenue, totals.priorRevenue);
            return `<td align="center" style="padding:6px 8px; color:${c.color}; font-weight:700; border-bottom:1px solid #f1f3f5; font-size:11px;">${c.text}</td>`;
          })()}
        </tr>
        <tr style="background-color:#f8f9fa;">
          <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6; font-size:12px;">Projected</td>
          ${BRANCHES.map(b => {
            const proj = workedDays > 0 ? (mtd[b].revenue / workedDays) * totalDays : 0;
            return `<td align="center" style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">${fmt(proj)}</td>`;
          }).join('')}
          <td align="center" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(projectedTotal)}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- TOP 5 REPS -->
  <tr>
    <td style="padding:20px 32px 0;">
      <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">Top Sales Reps — MTD</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px; border-collapse:collapse;">
        ${topRepsRows.map((rep, i) => `
        <tr>
          <td style="padding:7px 8px; color:#868e96; border-bottom:1px solid #f1f3f5; width:20px; font-weight:600;">${i + 1}</td>
          <td style="padding:7px 8px; color:#495057; border-bottom:1px solid #f1f3f5;">${rep.sales_rep}</td>
          <td align="right" style="padding:7px 8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${fmtFull(rep.revenue)}</td>
        </tr>`).join('')}
      </table>
    </td>
  </tr>

  <!-- CTA BUTTON -->
  <tr>
    <td align="center" style="padding:28px 32px 20px;">
      <a href="https://manager-reports-one.vercel.app" style="display:inline-block; background-color:#f26b2b; color:#ffffff; font-size:13px; font-weight:700; text-decoration:none; padding:13px 36px; border-radius:6px; letter-spacing:0.3px;">Open Full Dashboard →</a>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background-color:#f8f9fa; padding:16px 32px; text-align:center; border-top:1px solid #e9ecef;">
      <div style="font-size:10px; color:#adb5bd; letter-spacing:0.5px;">PACIFIC COAST TITLE COMPANY &nbsp;•&nbsp; MANAGEMENT REPORTS</div>
      <div style="font-size:10px; color:#adb5bd; margin-top:3px;">Data sourced from SoftPro &nbsp;•&nbsp; Auto-generated nightly</div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const subject = `PCT Daily Report — ${monthNames[month]} ${day}, ${year}`;
  return { html, subject, meta: { yesterdayStr, yearMonth, totals, workedDays, totalDays, remainingDays } };
}

// ============================================
// SEND REPORT
// ============================================
async function sendDailyReport(overrideDate) {
  // Check if email is enabled
  const { rows: settingRows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('daily_email_enabled', 'daily_email_recipients')"
  );
  const settings = {};
  settingRows.forEach(r => { settings[r.key] = r.value; });

  if (settings.daily_email_enabled === 'false') {
    console.log('Daily email disabled in settings — skipping');
    return { sent: false, reason: 'disabled' };
  }

  // Get recipients from app_settings (managed via Settings page)
  const recipientStr = settings.daily_email_recipients || '';
  const recipients = recipientStr.split(',').map(e => e.trim()).filter(Boolean);

  if (recipients.length === 0) {
    console.log('No recipients configured — skipping email send');
    return { sent: false, reason: 'no recipients' };
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new Error('SENDGRID_API_KEY not set');
  }
  sgMail.setApiKey(apiKey);

  const { html, subject } = await buildDailyReportHtml(overrideDate);

  const from = process.env.DAILY_REPORT_FROM || 'reports@pacificcoasttitle.com';

  await sgMail.send({ to: recipients, from, subject, html });
  console.log(`Daily report sent to: ${recipients.join(', ')}`);
  return { sent: true, recipients, subject };
}

module.exports = { buildDailyReportHtml, sendDailyReport };
