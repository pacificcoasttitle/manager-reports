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

const LOGO_URL = 'https://manager-reports-one.vercel.app/logo2.png';
const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');

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

  const worked = parseInt(workDays[0].worked);
  const totalDays = parseInt(workDays[0].total);
  const mtdRev = parseFloat(mtdClose[0].revenue) || 0;
  const projected = worked > 0 ? (mtdRev / worked) * totalDays : 0;
  const priorRev = parseFloat(priorClose[0].revenue) || 0;
  const pctChange = priorRev > 0 ? Math.round(((mtdRev - priorRev) / priorRev) * 100) : null;

  const ydayClosedCnt = parseInt(ydayClose[0].total_cnt) || 0;
  const reportDate = `${dayNames[yesterday.getDay()]}, ${monthNames[month]} ${yesterday.getDate()}, ${year}`;
  const firstName = officerName.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f5f5f5; font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center" style="padding:20px 10px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <tr><td style="background-color:#03374f; background-image:linear-gradient(135deg,#03374f 0%,#064a6b 100%); padding:28px 30px 22px;">
          <img src="${LOGO_URL}" alt="Pacific Coast Title" height="34" style="display:block; height:34px; width:auto; border:0; outline:none; margin-bottom:14px;">
          <div style="font-size:12px; color:#8db4d4; font-weight:600; letter-spacing:1.2px; text-transform:uppercase;">Daily Production Report</div>
        </td></tr>
        <tr><td style="height:4px; line-height:4px; font-size:0; background-color:#f26b2b;">&nbsp;</td></tr>

        <tr><td style="padding:24px 30px 8px;">
          <div style="font-size:16px; color:#03374f; font-weight:600;">Good morning, ${firstName}</div>
          <div style="font-size:13px; color:#868e96; margin-top:4px;">${reportDate}</div>
        </td></tr>

        <tr><td style="padding:16px 30px 8px;">
          <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:12px; border-left:3px solid #f26b2b; padding-left:10px;">Yesterday</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr>
              <td style="padding:8px 0; color:#495057;">Closed Orders</td>
              <td align="right" style="padding:8px 0; font-weight:600; color:#03374f;">${ydayClosedCnt}</td>
            </tr>
            <tr>
              <td style="padding:8px 0; color:#495057;">Revenue</td>
              <td align="right" style="padding:8px 0; font-weight:600; color:#f26b2b;">${fmt(ydayClose[0].revenue)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0; color:#495057;">New Orders Opened</td>
              <td align="right" style="padding:8px 0; font-weight:600; color:#03374f;">${ydayOpen[0].opens}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:16px 30px 8px;">
          <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:4px; border-left:3px solid #f26b2b; padding-left:10px;">Month to Date</div>
          <div style="font-size:12px; color:#868e96; margin-bottom:12px; padding-left:13px;">${monthNames[month]} 1\u2013${yesterday.getDate()} \u00b7 ${worked} of ${totalDays} working days</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr style="background:#f8f9fa;">
              <td style="padding:10px; color:#495057; font-weight:600;">Revenue</td>
              <td align="right" style="padding:10px; font-weight:700; color:#f26b2b; font-size:16px;">${fmt(mtdRev)}</td>
            </tr>
            <tr>
              <td style="padding:8px 10px; color:#495057;">Closed Orders</td>
              <td align="right" style="padding:8px 10px; font-weight:600;">${mtdClose[0].total_cnt} (${mtdClose[0].purchase_cnt} Purchase, ${mtdClose[0].refi_cnt} Refi)</td>
            </tr>
            <tr>
              <td style="padding:8px 10px; color:#495057;">New Orders Opened</td>
              <td align="right" style="padding:8px 10px; font-weight:600;">${mtdOpen[0].opens}</td>
            </tr>
            <tr>
              <td style="padding:8px 10px; color:#495057;">Projected Month-End</td>
              <td align="right" style="padding:8px 10px; font-weight:600; color:#03374f;">${fmt(projected)}</td>
            </tr>
            <tr>
              <td style="padding:8px 10px; color:#495057;">Prior Month (${monthNames[parseInt(priorMonth.split('-')[1])]})</td>
              <td align="right" style="padding:8px 10px; color:#868e96;">${fmt(priorRev)}${pctChange !== null ? ` (${pctChange >= 0 ? '\u25b2' : '\u25bc'} ${Math.abs(pctChange)}%)` : ''}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:20px 30px 26px; text-align:center; border-top:1px solid #f1f3f5;">
          <div style="font-size:12px; font-weight:700; color:#03374f; letter-spacing:0.3px;">Pacific Coast Title</div>
          <div style="font-size:11px; color:#adb5bd; margin-top:3px;">Your title production \u00b7 Generated automatically</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, subject: `Your Daily Production \u2014 ${monthNames[month]} ${yesterday.getDate()}`, hasData: true };
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
