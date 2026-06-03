/**
 * Per-officer daily email for Title Officers.
 * Each active title officer gets a personalized email showing ONLY their own
 * production (yesterday + MTD). Sent individually so no officer sees another's
 * numbers. Revenue = title_revenue + underwriter_revenue (matches Title Officer
 * Production tab). Date comparisons use ::date casts to match daily-email.js.
 *
 * Recipients live in officer_email_recipients (officer_name, email, officer_type,
 * is_active). Sends use SENDGRID_API_KEY + DAILY_REPORT_FROM.
 */

const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const LOGO_URL = 'https://www.pct.com/logo2-dark.png';
const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Renders the "Your Closings This Month" file-level breakdown section.
 * The Total row ties back to the hero MTD revenue number.
 */
function buildClosingsSection(closingsList) {
  if (!closingsList || closingsList.length === 0) {
    return `
  <!-- CLOSINGS (empty) -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">Your Closings This Month</div>
    <div style="font-size:13px; color:#868e96; text-align:center; padding:20px; background:#f8f9fa; border-radius:8px;">
      No closings yet this month \u2014 your pipeline is building.
    </div>
  </td></tr>`;
  }

  const total = closingsList.reduce((s, c) => s + parseFloat(c.amount), 0);
  const rows = closingsList.map((c, i) => `
      <tr style="border-bottom:1px solid #f1f3f5;${i % 2 === 1 ? ' background-color:#fafbfc;' : ''}">
        <td style="padding:8px 10px; font-family:'Courier New',monospace; font-size:12px; color:#03374f; white-space:nowrap;">${esc(c.file_number)}</td>
        <td style="padding:8px 10px; font-size:12px; color:#868e96;">${c.full_address ? esc(c.full_address) : '\u2014'}</td>
        <td align="right" style="padding:8px 10px; font-size:12px; font-weight:600; color:#03374f; white-space:nowrap;">${fmt(c.amount)}</td>
      </tr>`).join('');

  return `
  <!-- CLOSINGS -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">Your Closings This Month</div>
    <div style="font-size:11px; color:#868e96; margin-bottom:10px;">${closingsList.length} ${closingsList.length === 1 ? 'file' : 'files'} &nbsp;\u2022&nbsp; ${fmt(total)} total</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px; border-collapse:collapse;">
      <tr style="background-color:#f8f9fa;">
        <td style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">File</td>
        <td style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Property</td>
        <td align="right" style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Amount</td>
      </tr>${rows}
      <tr style="background-color:#fff8f0;">
        <td colspan="2" style="padding:10px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Total</td>
        <td align="right" style="padding:10px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(total)}</td>
      </tr>
    </table>
  </td></tr>`;
}

async function buildOfficerEmailHtml(officerName) {
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const yesterday = new Date(pacificNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const year = yesterday.getFullYear();
  const month = yesterday.getMonth() + 1;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;

  const [{ rows: ydayClose }, { rows: ydayOpen }, { rows: mtdClose }, { rows: mtdOpen }, { rows: priorClose }, { rows: workDays }] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) as total_cnt,
        COUNT(*) FILTER (WHERE category = 'Purchase') as purchase_cnt,
        COUNT(*) FILTER (WHERE category = 'Refinance') as refi_cnt,
        ROUND(SUM(title_revenue + underwriter_revenue)::numeric, 2) as revenue
      FROM order_summary
      WHERE title_officer = $1 AND transaction_date::date = $2::date
        AND (title_revenue + underwriter_revenue) > 0
    `, [officerName, yesterdayStr]),

    pool.query(`
      SELECT COUNT(*) as opens
      FROM open_orders
      WHERE title_officer = $1 AND received_date::date = $2::date
        AND order_type IN ('Title only', 'Title & Escrow')
    `, [officerName, yesterdayStr]),

    pool.query(`
      SELECT
        COUNT(*) as total_cnt,
        COUNT(*) FILTER (WHERE category = 'Purchase') as purchase_cnt,
        COUNT(*) FILTER (WHERE category = 'Refinance') as refi_cnt,
        ROUND(SUM(title_revenue + underwriter_revenue)::numeric, 2) as revenue
      FROM order_summary
      WHERE title_officer = $1 AND fetch_month = $2
        AND (title_revenue + underwriter_revenue) > 0
    `, [officerName, yearMonth]),

    pool.query(`
      SELECT COUNT(*) as opens
      FROM open_orders
      WHERE title_officer = $1 AND open_month = $2
        AND order_type IN ('Title only', 'Title & Escrow')
    `, [officerName, yearMonth]),

    pool.query(`
      SELECT COUNT(*) as cnt, ROUND(SUM(title_revenue + underwriter_revenue)::numeric, 2) as revenue
      FROM order_summary
      WHERE title_officer = $1 AND fetch_month = $2
        AND (title_revenue + underwriter_revenue) > 0
    `, [officerName, priorMonth]),

    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE d <= $2::date) as worked,
        COUNT(*) as total
      FROM generate_series($1::date, (date_trunc('month', $1::date) + interval '1 month - 1 day')::date, '1 day') d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    `, [`${yearMonth}-01`, yesterdayStr]),
  ]);

  // Rank among active title officers by MTD revenue
  const [{ rows: rankRows }, { rows: cntRows }] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) + 1 as rank FROM (
        SELECT title_officer, SUM(title_revenue + underwriter_revenue) as rev
        FROM order_summary
        WHERE fetch_month = $1 AND (title_revenue + underwriter_revenue) > 0
          AND title_officer IN (SELECT officer_name FROM officer_email_recipients WHERE officer_type = 'title' AND is_active = true)
        GROUP BY title_officer
        HAVING SUM(title_revenue + underwriter_revenue) > (
          SELECT COALESCE(SUM(title_revenue + underwriter_revenue), 0)
          FROM order_summary WHERE title_officer = $2 AND fetch_month = $1
        )
      ) ranked
    `, [yearMonth, officerName]),
    pool.query("SELECT COUNT(*)::int AS n FROM officer_email_recipients WHERE officer_type = 'title' AND is_active = true"),
  ]);

  // Every MTD closing that makes up this officer's revenue (title + UW)
  const { rows: closingsList } = await pool.query(`
    SELECT file_number, full_address, transaction_date, category,
           ROUND((title_revenue + underwriter_revenue)::numeric, 2) as amount
    FROM order_summary
    WHERE title_officer = $1 AND fetch_month = $2 AND (title_revenue + underwriter_revenue) > 0
    ORDER BY transaction_date DESC, (title_revenue + underwriter_revenue) DESC
  `, [officerName, yearMonth]);

  const worked = parseInt(workDays[0].worked);
  const totalDays = parseInt(workDays[0].total);
  const remaining = Math.max(0, totalDays - worked);
  const mtdRev = parseFloat(mtdClose[0].revenue) || 0;
  const projected = worked > 0 ? (mtdRev / worked) * totalDays : 0;
  const progressPct = projected > 0 ? Math.min(100, Math.round((mtdRev / projected) * 100)) : 0;
  const priorRev = parseFloat(priorClose[0].revenue) || 0;
  const pctChange = priorRev > 0 ? Math.round(((mtdRev - priorRev) / priorRev) * 100) : null;
  const rank = parseInt(rankRows[0].rank);
  const totalOfficers = cntRows[0].n || 4;

  const trendHtml = pctChange === null
    ? `<span style="color:#868e96;">\u2014 vs prior month</span>`
    : pctChange >= 0
      ? `<span style="color:#2f9e44;">\u25b2 ${pctChange}% vs prior month</span>`
      : `<span style="color:#e03131;">\u25bc ${Math.abs(pctChange)}% vs prior month</span>`;

  const ydayClosedCnt = parseInt(ydayClose[0].total_cnt) || 0;
  const day = yesterday.getDate();
  const priorMonthName = monthNames[parseInt(priorMonth.split('-')[1])];
  const reportDate = `${dayNames[yesterday.getDay()]}, ${monthNames[month]} ${day}, ${year}`;
  const firstName = officerName.split(' ')[0];

  const closingsSection = buildClosingsSection(closingsList);

  // Reconciliation guard: file-list total must equal hero MTD revenue
  const fileSum = closingsList.reduce((s, c) => s + parseFloat(c.amount), 0);
  if (Math.abs(mtdRev - fileSum) >= 0.01) {
    console.warn(`[officer-email] ${officerName}: hero MTD=${mtdRev} vs file list sum=${fileSum} — MISMATCH`);
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f0f2f5; font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;">
<tr><td align="center" style="padding:24px 12px;">

<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.10);">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#03374f 0%,#055a7e 100%); padding:26px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="top">
        <img src="${LOGO_URL}" alt="Pacific Coast Title" height="30" style="display:block; height:30px; width:auto; border:0; outline:none; margin-bottom:12px;">
        <div style="font-size:11px; font-weight:600; color:#8db4d4; letter-spacing:2px; text-transform:uppercase;">Daily Production Report</div>
        <div style="font-size:20px; font-weight:700; color:#ffffff; margin-top:4px; letter-spacing:-0.3px;">Good morning, ${firstName}</div>
      </td>
      <td align="right" valign="top"><div style="font-size:12px; color:#8db4d4; white-space:nowrap;">${reportDate}</div></td>
    </tr></table>
  </td></tr>

  <!-- HERO: MTD REVENUE -->
  <tr><td style="padding:30px 32px 14px; text-align:center;">
    <div style="font-size:12px; color:#868e96; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Month-to-Date Revenue</div>
    <div style="font-size:42px; font-weight:700; color:#03374f; margin:8px 0; letter-spacing:-1px;">${fmt(mtdRev)}</div>
    <div style="font-size:14px; font-weight:600;">${trendHtml}</div>
  </td></tr>

  <!-- PROGRESS BAR -->
  <tr><td style="padding:6px 32px 22px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:12px; color:#868e96;">MTD: ${fmt(mtdRev)}</td>
      <td align="right" style="font-size:12px; color:#868e96;">Projected: ${fmt(projected)}</td>
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#e9ecef; border-radius:10px; margin-top:6px;">
      <tr><td width="${progressPct}%" style="background-color:#f26b2b; height:10px; border-radius:10px; font-size:0; line-height:0;">&nbsp;</td><td style="font-size:0; line-height:0;">&nbsp;</td></tr>
    </table>
    <div style="font-size:11px; color:#adb5bd; margin-top:6px; text-align:center;">Day ${worked} of ${totalDays} working days \u00b7 ${remaining} remaining</div>
  </td></tr>

  <!-- RANK BADGE -->
  <tr><td style="padding:0 32px 24px; text-align:center;">
    <span style="display:inline-block; background-color:#fff8f0; border:1px solid #f7934f; color:#9a3412; font-size:13px; font-weight:600; padding:6px 16px; border-radius:20px;">&#127942; Rank #${rank} of ${totalOfficers} Title Officers</span>
  </td></tr>

  <!-- YESTERDAY -->
  <tr><td style="padding:4px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">Yesterday's Activity</div>
    <div style="font-size:11px; color:#868e96; margin-bottom:10px;">${reportDate}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; border-collapse:collapse;">
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">Closed Orders</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${ydayClosedCnt}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">New Orders Opened</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${ydayOpen[0].opens}</td>
      </tr>
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Revenue</td>
        <td align="right" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(ydayClose[0].revenue)}</td>
      </tr>
    </table>
  </td></tr>

  <!-- MTD DETAIL -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">Month-to-Date Detail</div>
    <div style="font-size:11px; color:#868e96; margin-bottom:10px;">${monthNames[month]} 1\u2013${day} &nbsp;\u2022&nbsp; ${worked} of ${totalDays} working days &nbsp;\u2022&nbsp; ${remaining} remaining</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; border-collapse:collapse;">
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">Closed Orders</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${mtdClose[0].total_cnt} <span style="color:#868e96; font-weight:400; font-size:12px;">(${mtdClose[0].purchase_cnt} Purchase \u00b7 ${mtdClose[0].refi_cnt} Refi)</span></td>
      </tr>
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">New Orders Opened</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${mtdOpen[0].opens}</td>
      </tr>
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6; border-bottom:1px solid #f1f3f5;">Revenue</td>
        <td align="right" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6; border-bottom:1px solid #f1f3f5;">${fmt(mtdRev)}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">Projected Month-End</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${fmt(projected)}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#868e96; font-size:12px;">${priorMonthName} (prior month)</td>
        <td align="right" style="padding:8px; color:#868e96; font-size:12px; font-weight:600;">${fmt(priorRev)}${pctChange !== null ? ` &nbsp;<span style="color:${pctChange >= 0 ? '#2f9e44' : '#e03131'};">${pctChange >= 0 ? '\u25b2' : '\u25bc'} ${Math.abs(pctChange)}%</span>` : ''}</td>
      </tr>
    </table>
  </td></tr>

  ${closingsSection}

  <tr><td style="padding:14px 32px 0;">&nbsp;</td></tr>

  <!-- FOOTER -->
  <tr><td style="background-color:#f8f9fa; padding:16px 32px; text-align:center; border-top:1px solid #e9ecef;">
    <div style="font-size:10px; color:#adb5bd; letter-spacing:0.5px;">PACIFIC COAST TITLE COMPANY &nbsp;\u2022&nbsp; YOUR TITLE PRODUCTION</div>
    <div style="font-size:10px; color:#adb5bd; margin-top:3px;">Data sourced from SoftPro &nbsp;\u2022&nbsp; Auto-generated nightly</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { html, subject: `Your Daily Production \u2014 ${monthNames[month]} ${day}`, hasData: true };
}

async function getActiveTitleOfficers() {
  const { rows } = await pool.query(
    "SELECT officer_name, email FROM officer_email_recipients WHERE is_active = true AND officer_type = 'title' AND email != 'PLACEHOLDER'"
  );
  return rows;
}

async function sendOfficerEmails() {
  const officers = await getActiveTitleOfficers();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const officer of officers) {
    try {
      const { html, subject } = await buildOfficerEmailHtml(officer.officer_name);
      await sgMail.send({ to: officer.email, from, subject, html });
      results.push({ officer: officer.officer_name, sentTo: officer.email, sent: true });
    } catch (err) {
      console.error(`Failed to send to ${officer.officer_name}:`, err.message);
      results.push({ officer: officer.officer_name, sent: false, error: err.message });
    }
  }
  return results;
}

// Sends every active officer's email to a SINGLE test address with a TEST banner
// and a [TEST -> Officer] subject prefix. No officer receives anything.
async function sendOfficerEmailsTest(testEmail) {
  const officers = await getActiveTitleOfficers();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const officer of officers) {
    try {
      const { html, subject } = await buildOfficerEmailHtml(officer.officer_name);
      const banner = `<div style="background:#fef3c7; color:#92400e; padding:12px 20px; text-align:center; font-family:Arial,sans-serif; font-size:13px; font-weight:600;">\u26a0\ufe0f TEST \u2014 This email would be sent to ${officer.officer_name} at ${officer.email}</div>`;
      const bannerHtml = html.replace('<body style="margin:0; padding:0; background:#f5f5f5; font-family:Arial,Helvetica,sans-serif;">',
        '<body style="margin:0; padding:0; background:#f5f5f5; font-family:Arial,Helvetica,sans-serif;">' + banner);
      await sgMail.send({
        to: testEmail,
        from,
        subject: `[TEST \u2192 ${officer.officer_name}] ${subject}`,
        html: bannerHtml,
      });
      results.push({ officer: officer.officer_name, sentTo: testEmail, sent: true });
    } catch (err) {
      console.error(`Test send failed for ${officer.officer_name}:`, err.message);
      results.push({ officer: officer.officer_name, sent: false, error: err.message });
    }
  }
  return results;
}

module.exports = { buildOfficerEmailHtml, sendOfficerEmails, sendOfficerEmailsTest, getActiveTitleOfficers };
