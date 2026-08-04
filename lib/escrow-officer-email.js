/**
 * Per-officer daily email for Escrow Officers.
 * Each active escrow officer gets a personalized email showing ONLY their own
 * commissionable escrow production (yesterday + MTD). Grouped on escrow_officer.
 *
 * Revenue = officer_commissionable_escrow (the wider escrow-officer base:
 * settlement + credits + loan tie-in + docs, net of negatives, capped at full
 * escrow), scoped by escrow_revenue > 0 (matches the reconciliation bar).
 *
 * Recipients live in officer_email_recipients (officer_type = 'escrow').
 * Wired into the 5 AM cron behind the escrow_officer_emails_enabled flag.
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

function buildClosingsSection(closingsList) {
  if (!closingsList || closingsList.length === 0) {
    return `
  <!-- ESCROW CLOSINGS (empty) -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">Escrow Closings This Month</div>
    <div style="font-size:13px; color:#868e96; text-align:center; padding:20px; background:#f8f9fa; border-radius:8px;">
      No escrow closings yet this month \u2014 your pipeline is building.
    </div>
  </td></tr>`;
  }

  const total = closingsList.reduce((s, c) => s + parseFloat(c.amount), 0);

  // Per-file tie status: components (tie-in excluded on conflict) must equal the file total.
  const fileTies = (c) => {
    const compSum = parseFloat(c.settlement || 0) + parseFloat(c.doc || 0)
      + (c.tiein_conflict ? 0 : parseFloat(c.tie_in || 0)) + parseFloat(c.credits || 0);
    return Math.abs(compSum - parseFloat(c.amount)) <= 0.01;
  };

  // Month-level component totals — sum over TIED files only, so the summary line can only be
  // shown when it exactly ties to the displayed total.
  const allTie = closingsList.every(fileTies);
  const monthComp = closingsList.reduce((a, c) => ({
    settlement: a.settlement + parseFloat(c.settlement || 0),
    doc: a.doc + parseFloat(c.doc || 0),
    tie_in: a.tie_in + (c.tiein_conflict ? 0 : parseFloat(c.tie_in || 0)),
    credits: a.credits + parseFloat(c.credits || 0),
  }), { settlement: 0, doc: 0, tie_in: 0, credits: 0 });

  // Build a compact "chip" line of non-zero components for a file.
  const compLine = (c) => {
    const parts = [];
    if (Math.abs(parseFloat(c.settlement || 0)) > 0.005) parts.push(`Settlement ${fmt(c.settlement)}`);
    if (Math.abs(parseFloat(c.doc || 0)) > 0.005) parts.push(`Doc ${fmt(c.doc)}`);
    // On a both-code conflict the tie-in is HELD OUT of the total — label it clearly
    // rather than showing a component that doesn't count toward the number.
    if (c.tiein_conflict) {
      parts.push(`<span style="color:#c92a2a;">Tie-in held (dup entry)</span>`);
    } else if (Math.abs(parseFloat(c.tie_in || 0)) > 0.005) {
      parts.push(`Tie-in ${fmt(c.tie_in)}`);
    }
    if (Math.abs(parseFloat(c.credits || 0)) > 0.005) parts.push(`Credits ${fmt(c.credits)}`);
    if (!parts.length) return '';
    return `<div style="font-size:11px; color:#868e96; padding:0 10px 8px; margin-top:-2px;">${parts.join(' &nbsp;\u00b7&nbsp; ')}</div>`;
  };

  const rows = closingsList.map((c, i) => {
    // Per-file reconciliation guard: components (tie-in excluded on conflict) must tie to the
    // authoritative amount. When they don't (negatives + cap/floor, or non-standard lines),
    // SUPPRESS the chips and show the total only — never render a breakdown that doesn't add
    // up (that would recreate the very confusion this feature removes).
    const ties = fileTies(c);
    if (!ties) {
      console.warn(`[escrow-officer-email] ${c.file_number}: component breakdown != officer total ${c.amount} (negatives/cap or non-standard line) — chips suppressed, total shown.`);
    }
    const cl = ties ? compLine(c) : '';
    return `
      <tr style="${i % 2 === 1 ? 'background-color:#fafbfc;' : ''}">
        <td style="padding:8px 10px 2px; font-family:'Courier New',monospace; font-size:12px; color:#03374f; white-space:nowrap; vertical-align:top;">${esc(c.file_number)}</td>
        <td style="padding:8px 10px 2px; font-size:12px; color:#868e96; vertical-align:top;">${c.full_address ? esc(c.full_address) : '\u2014'}</td>
        <td align="right" style="padding:8px 10px 2px; font-size:12px; font-weight:600; color:#03374f; white-space:nowrap; vertical-align:top;">${fmt(c.amount)}</td>
      </tr>
      <tr style="border-bottom:1px solid #f1f3f5;${i % 2 === 1 ? ' background-color:#fafbfc;' : ''}">
        <td colspan="3" style="padding:0;">${cl}</td>
      </tr>`;
  }).join('');

  // Month-level summary line — only when EVERY file ties (so it's guaranteed exact) and only
  // non-zero components. If any file's chips were suppressed, we omit the month line rather
  // than show a decomposition that doesn't equal the total.
  const monthParts = [];
  if (monthComp.settlement > 0.005) monthParts.push(`Settlement ${fmt(monthComp.settlement)}`);
  if (monthComp.doc > 0.005) monthParts.push(`Doc ${fmt(monthComp.doc)}`);
  if (monthComp.tie_in > 0.005) monthParts.push(`Tie-in ${fmt(monthComp.tie_in)}`);
  if (monthComp.credits > 0.005) monthParts.push(`Credits ${fmt(monthComp.credits)}`);
  const monthSummary = (allTie && monthParts.length)
    ? `<div style="font-size:11px; color:#868e96; margin-bottom:10px;">Your ${fmt(total)} =&nbsp; ${monthParts.join(' &nbsp;+&nbsp; ')}</div>`
    : '';

  return `
  <!-- ESCROW CLOSINGS -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">Escrow Closings This Month</div>
    <div style="font-size:11px; color:#868e96; margin-bottom:6px;">${closingsList.length} ${closingsList.length === 1 ? 'file' : 'files'} &nbsp;\u2022&nbsp; ${fmt(total)} total</div>
    ${monthSummary}
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

async function buildEscrowOfficerEmailHtml(officerName) {
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const yesterday = new Date(pacificNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const year = yesterday.getFullYear();
  const month = yesterday.getMonth() + 1;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;

  // Revenue = officer_commissionable_escrow (wider officer base), scoped by escrow_revenue > 0
  const [{ rows: mtdClose }, { rows: mtdOpen }, { rows: ydayClose }, { rows: ydayOpen }, { rows: priorClose }, { rows: workDays }, { rows: priorWorkDays }] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE officer_commissionable_escrow > 0) as total_cnt,
        ROUND(COALESCE(SUM(officer_commissionable_escrow),0)::numeric, 2) as revenue
      FROM order_summary
      WHERE escrow_officer = $1 AND fetch_month = $2 AND escrow_revenue > 0
    `, [officerName, yearMonth]),

    pool.query(`
      SELECT COUNT(*) as opens FROM open_orders
      WHERE escrow_officer = $1 AND open_month = $2
        AND LOWER(order_type) IN ('title & escrow', 'escrow only')
    `, [officerName, yearMonth]),

    pool.query(`
      SELECT COUNT(*) FILTER (WHERE officer_commissionable_escrow > 0) as total_cnt,
        ROUND(COALESCE(SUM(officer_commissionable_escrow),0)::numeric, 2) as revenue
      FROM order_summary
      WHERE escrow_officer = $1 AND transaction_date::date = $2::date AND escrow_revenue > 0
    `, [officerName, yesterdayStr]),

    pool.query(`
      SELECT COUNT(*) as opens FROM open_orders
      WHERE escrow_officer = $1 AND received_date::date = $2::date
        AND LOWER(order_type) IN ('title & escrow', 'escrow only')
    `, [officerName, yesterdayStr]),

    pool.query(`
      SELECT ROUND(COALESCE(SUM(officer_commissionable_escrow),0)::numeric, 2) as revenue
      FROM order_summary
      WHERE escrow_officer = $1 AND fetch_month = $2 AND escrow_revenue > 0
    `, [officerName, priorMonth]),

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

  // MTD escrow closings file list (commissionable amounts) — ties to hero MTD.
  // amount = officer_commissionable_escrow (authoritative, capped/floored/conflict-aware).
  // Component columns (settlement/doc/tie_in/credits) are DISPLAY-ONLY decompositions from
  // the line items — they explain the number; the stored `amount` remains the source of truth.
  const { rows: closingsList } = await pool.query(`
    SELECT os.file_number, os.full_address, os.transaction_date,
           ROUND(os.officer_commissionable_escrow::numeric, 2) as amount,
           ROUND(COALESCE(SUM(rli.sum_amount) FILTER (WHERE rli.bill_code='ESC'
             AND LOWER(rli.charge_description) LIKE '%settlement%'),0)::numeric,2) as settlement,
           ROUND(COALESCE(SUM(rli.sum_amount) FILTER (WHERE rli.bill_code='DOC'),0)::numeric,2) as doc,
           ROUND(COALESCE(SUM(rli.sum_amount) FILTER (WHERE
             (rli.bill_code='ESC' AND LOWER(rli.charge_description) LIKE '%tie%')
             OR rli.bill_code='LOANS'),0)::numeric,2) as tie_in,
           ROUND(COALESCE(SUM(rli.sum_amount) FILTER (WHERE rli.bill_code='ESC' AND
             (LOWER(rli.charge_description) LIKE '%courtesy%'
              OR LOWER(rli.charge_description) LIKE '%credit%'
              OR LOWER(rli.charge_description) LIKE '%discount%')),0)::numeric,2) as credits,
           BOOL_OR(rli.bill_code='ESC' AND LOWER(rli.charge_description) LIKE '%tie%') AND
             BOOL_OR(rli.bill_code='LOANS') as tiein_conflict
    FROM order_summary os
    LEFT JOIN revenue_line_items rli
      ON rli.file_number = os.file_number AND rli.fetch_month = os.fetch_month
      AND rli.bill_code IN ('ESC','DOC','LOANS')
    WHERE os.escrow_officer = $1 AND os.fetch_month = $2
      AND os.escrow_revenue > 0 AND os.officer_commissionable_escrow > 0
    GROUP BY os.file_number, os.full_address, os.transaction_date, os.officer_commissionable_escrow
    ORDER BY os.transaction_date DESC, os.officer_commissionable_escrow DESC
  `, [officerName, yearMonth]);

  const worked = parseInt(workDays[0].worked);
  const totalDays = parseInt(workDays[0].total);
  const remaining = Math.max(0, totalDays - worked);
  const mtdRev = parseFloat(mtdClose[0].revenue) || 0;
  const projected = worked > 0 ? (mtdRev / worked) * totalDays : 0;
  const progressPct = projected > 0 ? Math.min(100, Math.round((mtdRev / projected) * 100)) : 0;
  const priorRev = parseFloat(priorClose[0].revenue) || 0;
  const priorTotalWorkingDays = parseInt(priorWorkDays[0].total);
  const trend = pctChangePace(mtdRev, priorRev, worked, priorTotalWorkingDays);
  const trendHtml = `<span style="color:${trend.color};">${trend.text}</span>`;

  const ydayClosedCnt = parseInt(ydayClose[0].total_cnt) || 0;
  const day = yesterday.getDate();
  const priorMonthName = monthNames[parseInt(priorMonth.split('-')[1])];
  const reportDate = `${dayNames[yesterday.getDay()]}, ${monthNames[month]} ${day}, ${year}`;
  const firstName = officerName.split(' ')[0];

  const closingsSection = buildClosingsSection(closingsList);

  // Reconciliation guard: file-list total must equal hero MTD commissionable
  const fileSum = closingsList.reduce((s, c) => s + parseFloat(c.amount), 0);
  if (Math.abs(mtdRev - fileSum) >= 0.01) {
    console.warn(`[escrow-officer-email] ${officerName}: hero MTD=${mtdRev} vs file list sum=${fileSum} — MISMATCH`);
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
        <div style="font-size:11px; font-weight:600; color:#8db4d4; letter-spacing:2px; text-transform:uppercase;">Escrow Production Report</div>
        <div style="font-size:20px; font-weight:700; color:#ffffff; margin-top:4px; letter-spacing:-0.3px;">Good morning, ${firstName}</div>
      </td>
      <td align="right" valign="top"><div style="font-size:12px; color:#8db4d4; white-space:nowrap;">${reportDate}</div></td>
    </tr></table>
  </td></tr>

  <!-- HERO: MTD COMMISSIONABLE -->
  <tr><td style="padding:30px 32px 14px; text-align:center;">
    <div style="font-size:12px; color:#868e96; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Month-to-Date Escrow Production</div>
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
        <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Commissionable Escrow</td>
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
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${mtdClose[0].total_cnt}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">New Orders Opened</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${mtdOpen[0].opens}</td>
      </tr>
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6; border-bottom:1px solid #f1f3f5;">Commissionable Escrow</td>
        <td align="right" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6; border-bottom:1px solid #f1f3f5;">${fmt(mtdRev)}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">Projected Month-End</td>
        <td align="right" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${fmt(projected)}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#868e96; font-size:12px;">${priorMonthName} (prior month)</td>
        <td align="right" style="padding:8px; color:#868e96; font-size:12px; font-weight:600;">${fmt(priorRev)}${trend.pct !== null ? ` &nbsp;<span style="color:${trend.color};">${trend.pct >= 0 ? '\u25b2' : '\u25bc'} ${Math.abs(trend.pct)}%</span>` : ''}</td>
      </tr>
    </table>
  </td></tr>

  ${closingsSection}

  <tr><td style="padding:14px 32px 0;">&nbsp;</td></tr>

  <!-- FOOTER -->
  <tr><td style="background-color:#f8f9fa; padding:16px 32px; text-align:center; border-top:1px solid #e9ecef;">
    <div style="font-size:10px; color:#adb5bd; letter-spacing:0.5px;">PACIFIC COAST TITLE COMPANY &nbsp;\u2022&nbsp; YOUR ESCROW PRODUCTION</div>
    <div style="font-size:10px; color:#adb5bd; margin-top:3px;">Data sourced from SoftPro &nbsp;\u2022&nbsp; Auto-generated nightly</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { html, subject: `Your Escrow Production \u2014 ${monthNames[month]} ${day}`, hasData: true };
}

async function getActiveEscrowOfficers() {
  const { rows } = await pool.query(
    "SELECT officer_name, email FROM officer_email_recipients WHERE is_active = true AND officer_type = 'escrow' AND email != 'PLACEHOLDER'"
  );
  return rows;
}

async function sendEscrowOfficerEmails() {
  const officers = await getActiveEscrowOfficers();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const officer of officers) {
    try {
      const { html, subject } = await buildEscrowOfficerEmailHtml(officer.officer_name);
      await sgMail.send({ to: officer.email, from, subject, html });
      results.push({ officer: officer.officer_name, sentTo: officer.email, sent: true });
    } catch (err) {
      console.error(`Failed to send to ${officer.officer_name}:`, err.message);
      results.push({ officer: officer.officer_name, sent: false, error: err.message });
    }
  }
  return results;
}

// Sends every active escrow officer's email to a SINGLE test address with a TEST banner.
async function sendEscrowOfficerEmailsTest(testEmail) {
  const officers = await getActiveEscrowOfficers();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const officer of officers) {
    try {
      const { html, subject } = await buildEscrowOfficerEmailHtml(officer.officer_name);
      const banner = `<div style="background:#fef3c7; color:#92400e; padding:12px 20px; text-align:center; font-family:Arial,sans-serif; font-size:13px; font-weight:600;">\u26a0\ufe0f TEST \u2192 This email would be sent to ${officer.officer_name} at ${officer.email}</div>`;
      await sgMail.send({
        to: testEmail,
        from,
        subject: `[TEST \u2192 ${officer.officer_name}] ${subject}`,
        html: banner + html,
      });
      results.push({ officer: officer.officer_name, sentTo: testEmail, sent: true });
    } catch (err) {
      console.error(`Test send failed for ${officer.officer_name}:`, err.message);
      results.push({ officer: officer.officer_name, sent: false, error: err.message });
    }
  }
  return results;
}

module.exports = { buildEscrowOfficerEmailHtml, sendEscrowOfficerEmails, sendEscrowOfficerEmailsTest, getActiveEscrowOfficers };
