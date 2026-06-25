/**
 * Per-rep daily email for Sales Reps.
 * Each active rep (with an email in rep_manager_assignments) gets a personalized
 * email showing ONLY their own production (yesterday + MTD). Revenue = total_revenue
 * (all the rep's business — title + escrow + TSG). Visual template mirrors the
 * enhanced lib/officer-email.js (hero number, progress bar, trend arrow).
 *
 * Recipients live in rep_manager_assignments (sales_rep, manager_name, email, is_active).
 * Sends use SENDGRID_API_KEY + DAILY_REPORT_FROM.
 */

const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');
const { pctChangePace } = require('./email-helpers');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const LOGO_URL = 'https://www.pct.com/logo2-dark.png';
const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Renders a file-level closings list (file number + address + amount) whose
 * Total row ties back to a revenue stream. Used for both the Title Closings
 * and Escrow Closings lists. A Title & Escrow file legitimately appears in
 * both lists with different amounts (title fee vs. escrow fee) — not a dupe.
 */
function buildClosingsSection(closingsList, opts) {
  const { header, emptyMsg } = opts;

  if (!closingsList || closingsList.length === 0) {
    return `
  <!-- ${header} (empty) -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">${header}</div>
    <div style="font-size:13px; color:#868e96; text-align:center; padding:20px; background:#f8f9fa; border-radius:8px;">
      ${emptyMsg}
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
  <!-- ${header} -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">${header}</div>
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

/** Renders the MTD Production streams table (title / escrow / TSG → total). */
function buildStreamsSection(titleRev, commEscrow, tsgRev, repTotal) {
  const streamRow = (label, amount, note) => `
      <tr>
        <td style="padding:9px 8px; color:#495057; border-bottom:1px solid #f1f3f5;">${label}${note ? ` <span style="color:#adb5bd; font-size:11px; font-weight:400;">${note}</span>` : ''}</td>
        <td align="right" style="padding:9px 8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${fmt(amount)}</td>
      </tr>`;
  return `
  <!-- MTD PRODUCTION STREAMS -->
  <tr><td style="padding:4px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">Month-to-Date Production</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; border-collapse:collapse;">
      ${streamRow('Title Revenue', titleRev)}
      ${streamRow('Escrow Revenue', commEscrow, '(commissionable)')}
      ${streamRow('TSG Revenue', tsgRev)}
      <tr style="background-color:#fff8f0;">
        <td style="padding:11px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Total Production</td>
        <td align="right" style="padding:11px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(repTotal)}</td>
      </tr>
    </table>
  </td></tr>`;
}

async function buildRepEmailHtml(repName) {
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const yesterday = new Date(pacificNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const year = yesterday.getFullYear();
  const month = yesterday.getMonth() + 1;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;

  const [{ rows: mtd }, { rows: opens }, { rows: yday }, { rows: ydayOpen }, { rows: prior }, { rows: wd }, { rows: priorWorkDays }] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) as cnt,
        COUNT(*) FILTER (WHERE category = 'Purchase') as purchase_cnt,
        COUNT(*) FILTER (WHERE category = 'Refinance') as refi_cnt,
        COUNT(*) FILTER (WHERE category = 'Escrow') as escrow_cnt,
        COUNT(*) FILTER (WHERE category = 'TSG') as tsg_cnt,
        ROUND(SUM(total_revenue)::numeric, 2) as rev,
        ROUND(COALESCE(SUM(title_revenue + underwriter_revenue),0)::numeric, 2) as title_stream,
        ROUND(COALESCE(SUM(tsg_revenue),0)::numeric, 2) as tsg_stream,
        ROUND(COALESCE(SUM(CASE WHEN escrow_revenue > 0 THEN commissionable_escrow ELSE 0 END),0)::numeric, 2) as comm_escrow
      FROM order_summary WHERE sales_rep = $1 AND fetch_month = $2
    `, [repName, yearMonth]),

    pool.query(`
      SELECT COUNT(*) as cnt FROM open_orders
      WHERE sales_rep = $1 AND open_month = $2 AND file_number NOT ILIKE 'test%'
    `, [repName, yearMonth]),

    pool.query(`
      SELECT COUNT(*) as cnt, ROUND(SUM(total_revenue)::numeric, 2) as rev
      FROM order_summary WHERE sales_rep = $1 AND transaction_date::date = $2::date
    `, [repName, yesterdayStr]),

    pool.query(`
      SELECT COUNT(*) as cnt FROM open_orders
      WHERE sales_rep = $1 AND received_date::date = $2::date AND file_number NOT ILIKE 'test%'
    `, [repName, yesterdayStr]),

    pool.query(`
      SELECT ROUND(COALESCE(
               SUM(title_revenue + underwriter_revenue + tsg_revenue)
               + SUM(CASE WHEN escrow_revenue > 0 THEN commissionable_escrow ELSE 0 END)
             ,0)::numeric, 2) as rev
      FROM order_summary WHERE sales_rep = $1 AND fetch_month = $2
    `, [repName, priorMonth]),

    pool.query(`
      SELECT COUNT(*) FILTER (WHERE d <= $2::date) as worked, COUNT(*) as total
      FROM generate_series($1::date, (date_trunc('month', $1::date) + interval '1 month - 1 day')::date, '1 day') d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    `, [`${yearMonth}-01`, yesterdayStr]),

    pool.query(`
      SELECT COUNT(*) as total
      FROM generate_series($1::date, (date_trunc('month', $1::date) + interval '1 month - 1 day')::date, '1 day') d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    `, [`${priorMonth}-01`]),
  ]);

  // Title Closings — sums to the Title Revenue stream
  const { rows: titleClosings } = await pool.query(`
    SELECT file_number, full_address, transaction_date,
           ROUND((title_revenue + underwriter_revenue)::numeric, 2) as amount
    FROM order_summary
    WHERE sales_rep = $1 AND fetch_month = $2 AND (title_revenue + underwriter_revenue) > 0
    ORDER BY transaction_date DESC, (title_revenue + underwriter_revenue) DESC
  `, [repName, yearMonth]);

  // Escrow Closings — commissionable escrow only; sums to the Escrow Revenue stream
  const { rows: escrowClosings } = await pool.query(`
    SELECT file_number, full_address, transaction_date,
           ROUND(commissionable_escrow::numeric, 2) as amount
    FROM order_summary
    WHERE sales_rep = $1 AND fetch_month = $2
      AND commissionable_escrow > 0
    ORDER BY transaction_date DESC, commissionable_escrow DESC
  `, [repName, yearMonth]);

  const worked = parseInt(wd[0].worked);
  const totalDays = parseInt(wd[0].total);
  const remaining = Math.max(0, totalDays - worked);

  // Rep-facing revenue streams — kept separate, never lumped with company total_revenue
  const titleRev = parseFloat(mtd[0].title_stream) || 0;
  const commEscrow = parseFloat(mtd[0].comm_escrow) || 0;
  const tsgRev = parseFloat(mtd[0].tsg_stream) || 0;
  const repTotal = Math.round((titleRev + commEscrow + tsgRev) * 100) / 100;

  const projected = worked > 0 ? (repTotal / worked) * totalDays : 0;
  const progressPct = projected > 0 ? Math.min(100, Math.round((repTotal / projected) * 100)) : 0;
  const priorRev = parseFloat(prior[0].rev) || 0;
  const priorTotalWorkingDays = parseInt(priorWorkDays[0].total);
  const trend = pctChangePace(repTotal, priorRev, worked, priorTotalWorkingDays);
  const pctChange = trend.pct;
  const trendHtml = `<span style="color:${trend.color};">${trend.text}</span>`;

  const purchaseCnt = parseInt(mtd[0].purchase_cnt) || 0;
  const refiCnt = parseInt(mtd[0].refi_cnt) || 0;
  const escrowCnt = parseInt(mtd[0].escrow_cnt) || 0;
  const tsgCnt = parseInt(mtd[0].tsg_cnt) || 0;
  const catParts = [];
  if (purchaseCnt > 0) catParts.push(`${purchaseCnt} Purchase`);
  if (refiCnt > 0) catParts.push(`${refiCnt} Refi`);
  if (escrowCnt > 0) catParts.push(`${escrowCnt} Escrow`);
  if (tsgCnt > 0) catParts.push(`${tsgCnt} TSG`);
  const catLabel = catParts.length ? `(${catParts.join(' \u00b7 ')})` : '';

  const ydayClosedCnt = parseInt(yday[0].cnt) || 0;
  const day = yesterday.getDate();
  const priorMonthName = monthNames[parseInt(priorMonth.split('-')[1])];
  const reportDate = `${dayNames[yesterday.getDay()]}, ${monthNames[month]} ${day}, ${year}`;
  const firstName = repName.split(' ')[0];

  const streamsSection = buildStreamsSection(titleRev, commEscrow, tsgRev, repTotal);
  const titleSection = buildClosingsSection(titleClosings, {
    header: 'Title Closings',
    emptyMsg: 'No title closings yet this month \u2014 your pipeline is building.',
  });
  const escrowSection = buildClosingsSection(escrowClosings, {
    header: 'Escrow Closings',
    emptyMsg: 'No escrow revenue collected this month.',
  });

  // Reconciliation guards: each list sums to its stream; streams sum to rep total
  const titleListSum = titleClosings.reduce((s, c) => s + parseFloat(c.amount), 0);
  if (Math.abs(titleListSum - titleRev) > 0.01) {
    console.warn(`[rep-email] ${repName}: title list ${titleListSum} != title stream ${titleRev}`);
  }
  const escrowListSum = escrowClosings.reduce((s, c) => s + parseFloat(c.amount), 0);
  if (Math.abs(escrowListSum - commEscrow) > 0.01) {
    console.warn(`[rep-email] ${repName}: escrow list ${escrowListSum} != escrow stream ${commEscrow}`);
  }
  if (Math.abs((titleRev + commEscrow + tsgRev) - repTotal) > 0.01) {
    console.warn(`[rep-email] ${repName}: streams don't sum to repTotal`);
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

  <!-- HERO: MTD PRODUCTION -->
  <tr><td style="padding:30px 32px 14px; text-align:center;">
    <div style="font-size:12px; color:#868e96; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Month-to-Date Production</div>
    <div style="font-size:42px; font-weight:700; color:#03374f; margin:8px 0; letter-spacing:-1px;">${fmt(repTotal)}</div>
    <div style="font-size:14px; font-weight:600;">${trendHtml}</div>
  </td></tr>

  <!-- PROGRESS BAR -->
  <tr><td style="padding:6px 32px 22px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:12px; color:#868e96;">MTD: ${fmt(repTotal)}</td>
      <td align="right" style="font-size:12px; color:#868e96;">Projected: ${fmt(projected)}</td>
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#e9ecef; border-radius:10px; margin-top:6px;">
      <tr><td width="${progressPct}%" style="background-color:#f26b2b; height:10px; border-radius:10px; font-size:0; line-height:0;">&nbsp;</td><td style="font-size:0; line-height:0;">&nbsp;</td></tr>
    </table>
    <div style="font-size:11px; color:#adb5bd; margin-top:6px; text-align:center;">Day ${worked} of ${totalDays} working days \u00b7 ${remaining} remaining</div>
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
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${ydayOpen[0].cnt}</td>
      </tr>
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Revenue</td>
        <td align="right" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(yday[0].rev)}</td>
      </tr>
    </table>
  </td></tr>

  ${streamsSection}

  <!-- MTD DETAIL -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">Month-to-Date Detail</div>
    <div style="font-size:11px; color:#868e96; margin-bottom:10px;">${monthNames[month]} 1\u2013${day} &nbsp;\u2022&nbsp; ${worked} of ${totalDays} working days &nbsp;\u2022&nbsp; ${remaining} remaining</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; border-collapse:collapse;">
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">Closed Orders</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${mtd[0].cnt}${catLabel ? ` <span style="color:#868e96; font-weight:400; font-size:12px;">${catLabel}</span>` : ''}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">New Orders Opened</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${opens[0].cnt}</td>
      </tr>
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6; border-bottom:1px solid #f1f3f5;">Total Production</td>
        <td align="right" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6; border-bottom:1px solid #f1f3f5;">${fmt(repTotal)}</td>
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

  ${titleSection}

  ${escrowSection}

  <tr><td style="padding:14px 32px 0;">&nbsp;</td></tr>

  <!-- FOOTER -->
  <tr><td style="background-color:#f8f9fa; padding:16px 32px; text-align:center; border-top:1px solid #e9ecef;">
    <div style="font-size:10px; color:#adb5bd; letter-spacing:0.5px;">PACIFIC COAST TITLE COMPANY &nbsp;\u2022&nbsp; YOUR PRODUCTION</div>
    <div style="font-size:10px; color:#adb5bd; margin-top:3px;">Data sourced from SoftPro &nbsp;\u2022&nbsp; Auto-generated nightly</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { html, subject: `Your Daily Production \u2014 ${monthNames[month]} ${day}`, hasData: true };
}

async function getActiveReps() {
  const { rows } = await pool.query(
    "SELECT sales_rep, email FROM rep_manager_assignments WHERE email IS NOT NULL AND email != '' AND is_active = true ORDER BY sales_rep"
  );
  return rows;
}

async function sendRepEmails() {
  const reps = await getActiveReps();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const rep of reps) {
    try {
      const { html, subject } = await buildRepEmailHtml(rep.sales_rep);
      await sgMail.send({ to: rep.email, from, subject, html });
      results.push({ rep: rep.sales_rep, sentTo: rep.email, sent: true });
    } catch (err) {
      console.error(`Failed to send to ${rep.sales_rep}:`, err.message);
      results.push({ rep: rep.sales_rep, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendRepEmailsTest(testEmail) {
  const reps = await getActiveReps();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const rep of reps) {
    try {
      const { html, subject } = await buildRepEmailHtml(rep.sales_rep);
      const banner = `<div style="background:#fef3c7; color:#92400e; padding:12px 20px; text-align:center; font-family:Arial,sans-serif; font-size:13px; font-weight:600;">\u26a0\ufe0f TEST \u2014 would go to ${rep.sales_rep} at ${rep.email}</div>`;
      await sgMail.send({ to: testEmail, from, subject: `[TEST \u2192 ${rep.sales_rep}] ${subject}`, html: banner + html });
      results.push({ rep: rep.sales_rep, sent: true });
    } catch (err) {
      results.push({ rep: rep.sales_rep, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendRepEmailsSample(testEmail, sampleReps) {
  const reps = sampleReps && sampleReps.length ? sampleReps : ['Kevin Green', 'Angeline Wu', 'Sandra Millar'];
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const repName of reps) {
    try {
      const { html, subject } = await buildRepEmailHtml(repName);
      const banner = `<div style="background:#fef3c7; color:#92400e; padding:12px 20px; text-align:center; font-family:Arial,sans-serif; font-size:13px; font-weight:600;">\u26a0\ufe0f TEST \u2192 ${repName}</div>`;
      await sgMail.send({ to: testEmail, from, subject: `[TEST \u2192 ${repName}] ${subject}`, html: banner + html });
      results.push({ rep: repName, sent: true });
    } catch (err) {
      results.push({ rep: repName, sent: false, error: err.message });
    }
  }
  return results;
}

module.exports = { buildRepEmailHtml, sendRepEmails, sendRepEmailsTest, sendRepEmailsSample, getActiveReps };
