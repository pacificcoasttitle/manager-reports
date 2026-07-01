/**
 * Month-end recap email for Sales Reps — a distinct "Month Final" email for a
 * COMPLETED month (no partial-month logic, no progress bar, no projection).
 *
 * Fires on the 1st of the month (~7:30 AM Pacific), recapping the just-completed
 * prior month. Recipients = the same daily-rep list (rep_manager_assignments,
 * is_active), but reps whose recap-month total is $0 are SKIPPED so nobody gets a
 * deflating "$0 recap".
 *
 * Revenue basis matches the daily rep email: title_revenue + underwriter_revenue,
 * commissionable_escrow (escrow_revenue > 0), and tsg_revenue — three streams that
 * sum to the rep's total. Trend uses the shared pace helper, full month vs full
 * prior month (clean apples-to-apples since both months are complete).
 */

const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');
const { pctChangePace } = require('./email-helpers');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const LOGO_URL = 'https://www.pct.com/logo2-dark.png';
const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function priorMonthOf(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

async function workingDays(yearMonth) {
  const { rows } = await pool.query(`
    SELECT COUNT(*) as d FROM generate_series(($1||'-01')::date,
      (date_trunc('month',($1||'-01')::date)+interval '1 month - 1 day')::date,'1 day') g(d)
    WHERE EXTRACT(DOW FROM g.d) NOT IN (0,6)
  `, [yearMonth]);
  return parseInt(rows[0].d);
}

/**
 * Build the recap HTML for one rep + a completed month.
 * recapMonth = 'YYYY-MM'. Returns { html, subject, repTotal, closings }.
 */
async function buildRepRecapHtml(repName, recapMonth) {
  const [ry, rm] = recapMonth.split('-').map(Number);
  const priorMonth = priorMonthOf(recapMonth);

  // Rep's final total for the recap month — 3 streams
  const { rows: totals } = await pool.query(`
    SELECT
      ROUND(COALESCE(SUM(title_revenue + underwriter_revenue),0)::numeric, 2) as title,
      ROUND(COALESCE(SUM(commissionable_escrow) FILTER (WHERE escrow_revenue > 0),0)::numeric, 2) as comm_escrow,
      ROUND(COALESCE(SUM(tsg_revenue),0)::numeric, 2) as tsg,
      COUNT(*) as closings
    FROM order_summary
    WHERE sales_rep = $1 AND fetch_month = $2
  `, [repName, recapMonth]);

  const titleRev = parseFloat(totals[0].title) || 0;
  const commEscrow = parseFloat(totals[0].comm_escrow) || 0;
  const tsgRev = parseFloat(totals[0].tsg) || 0;
  const repTotal = Math.round((titleRev + commEscrow + tsgRev) * 100) / 100;
  const closings = parseInt(totals[0].closings) || 0;

  // Prior-month rep total (same 3-stream basis) for the pace comparison
  const { rows: priorRows } = await pool.query(`
    SELECT ROUND((
      COALESCE(SUM(title_revenue + underwriter_revenue),0)
      + COALESCE(SUM(commissionable_escrow) FILTER (WHERE escrow_revenue > 0),0)
      + COALESCE(SUM(tsg_revenue),0))::numeric, 2) as prior_total
    FROM order_summary WHERE sales_rep = $1 AND fetch_month = $2
  `, [repName, priorMonth]);
  const priorTotal = parseFloat(priorRows[0].prior_total) || 0;

  // Both months COMPLETE → full working days each (clean full-vs-full pace)
  const recapWD = await workingDays(recapMonth);
  const priorWD = await workingDays(priorMonth);
  const trend = pctChangePace(repTotal, priorTotal, recapWD, priorWD);
  const trendHtml = `<span style="color:${trend.color};">${trend.text}</span>`;

  // Closings list — one combined row per file (title + comm escrow + tsg),
  // which sums exactly to repTotal (single-list reconciliation guard).
  const { rows: closingsList } = await pool.query(`
    SELECT file_number, full_address, transaction_date,
      ROUND((
        (title_revenue + underwriter_revenue)
        + (CASE WHEN escrow_revenue > 0 THEN commissionable_escrow ELSE 0 END)
        + tsg_revenue)::numeric, 2) as rep_amount
    FROM order_summary
    WHERE sales_rep = $1 AND fetch_month = $2
      AND (
        (title_revenue + underwriter_revenue)
        + (CASE WHEN escrow_revenue > 0 THEN commissionable_escrow ELSE 0 END)
        + tsg_revenue) > 0
    ORDER BY transaction_date, file_number
  `, [repName, recapMonth]);

  // Reconciliation guard: closings list sums to the hero repTotal
  const listSum = closingsList.reduce((s, c) => s + parseFloat(c.rep_amount), 0);
  if (Math.abs(listSum - repTotal) > 0.01) {
    console.warn(`[rep-recap] ${repName} ${recapMonth}: closings list ${listSum.toFixed(2)} != repTotal ${repTotal.toFixed(2)}`);
  }
  if (Math.abs((titleRev + commEscrow + tsgRev) - repTotal) > 0.01) {
    console.warn(`[rep-recap] ${repName} ${recapMonth}: streams don't sum to repTotal`);
  }

  const recapLabel = `${monthNames[rm]} ${ry}`;
  const priorLabel = monthNames[priorMonthOf(recapMonth).split('-')[1] * 1];
  const firstName = repName.split(' ')[0];

  const streamRow = (label, amount, note) => `
      <tr>
        <td style="padding:9px 8px; color:#495057; border-bottom:1px solid #f1f3f5;">${label}${note ? ` <span style="color:#adb5bd; font-size:11px; font-weight:400;">${note}</span>` : ''}</td>
        <td align="right" style="padding:9px 8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${fmt(amount)}</td>
      </tr>`;

  const closingsRows = closingsList.map((c, i) => `
      <tr style="border-bottom:1px solid #f1f3f5;${i % 2 === 1 ? ' background-color:#fafbfc;' : ''}">
        <td style="padding:8px 10px; font-family:'Courier New',monospace; font-size:12px; color:#03374f; white-space:nowrap;">${esc(c.file_number)}</td>
        <td style="padding:8px 10px; font-size:12px; color:#868e96;">${c.full_address ? esc(c.full_address) : '\u2014'}</td>
        <td align="right" style="padding:8px 10px; font-size:12px; font-weight:600; color:#03374f; white-space:nowrap;">${fmt(c.rep_amount)}</td>
      </tr>`).join('');

  const closingsSection = closingsList.length === 0 ? `
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">${recapLabel} Closings</div>
    <div style="font-size:13px; color:#868e96; text-align:center; padding:20px; background:#f8f9fa; border-radius:8px;">No closings recorded for ${recapLabel}.</div>
  </td></tr>` : `
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:3px;">${recapLabel} Closings</div>
    <div style="font-size:11px; color:#868e96; margin-bottom:10px;">${closingsList.length} ${closingsList.length === 1 ? 'file' : 'files'} &nbsp;\u2022&nbsp; ${fmt(repTotal)} total</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px; border-collapse:collapse;">
      <tr style="background-color:#f8f9fa;">
        <td style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">File</td>
        <td style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Property</td>
        <td align="right" style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Amount</td>
      </tr>${closingsRows}
      <tr style="background-color:#fff8f0;">
        <td colspan="2" style="padding:10px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Total</td>
        <td align="right" style="padding:10px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(repTotal)}</td>
      </tr>
    </table>
  </td></tr>`;

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
        <div style="font-size:11px; font-weight:600; color:#8db4d4; letter-spacing:2px; text-transform:uppercase;">Month-End Recap</div>
        <div style="font-size:20px; font-weight:700; color:#ffffff; margin-top:4px; letter-spacing:-0.3px;">${recapLabel} Final Numbers</div>
      </td>
      <td align="right" valign="top"><div style="font-size:12px; color:#8db4d4; white-space:nowrap;">${firstName}</div></td>
    </tr></table>
  </td></tr>

  <!-- HERO: FINAL MONTH TOTAL -->
  <tr><td style="padding:30px 32px 14px; text-align:center;">
    <div style="font-size:12px; color:#868e96; text-transform:uppercase; letter-spacing:1px; font-weight:600;">${recapLabel} Total Production</div>
    <div style="font-size:42px; font-weight:700; color:#03374f; margin:8px 0; letter-spacing:-1px;">${fmt(repTotal)}</div>
    <div style="font-size:14px; font-weight:600;">${trendHtml}</div>
    <div style="font-size:12px; color:#868e96; margin-top:6px;">${priorLabel}: ${fmt(priorTotal)} &nbsp;\u2022&nbsp; ${closings} ${closings === 1 ? 'closing' : 'closings'}</div>
  </td></tr>

  <!-- STREAMS -->
  <tr><td style="padding:10px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">Production by Stream</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; border-collapse:collapse;">
      ${streamRow('Title Revenue', titleRev)}
      ${streamRow('Escrow Revenue', commEscrow, '(commissionable)')}
      ${streamRow('TSG Revenue', tsgRev)}
      <tr style="background-color:#fff8f0;">
        <td style="padding:11px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Total</td>
        <td align="right" style="padding:11px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(repTotal)}</td>
      </tr>
    </table>
  </td></tr>

  ${closingsSection}

  <tr><td style="padding:14px 32px 0;">&nbsp;</td></tr>

  <!-- FOOTER -->
  <tr><td style="background-color:#f8f9fa; padding:16px 32px; text-align:center; border-top:1px solid #e9ecef;">
    <div style="font-size:10px; color:#adb5bd; letter-spacing:0.5px;">PACIFIC COAST TITLE COMPANY &nbsp;\u2022&nbsp; ${recapLabel.toUpperCase()} FINAL</div>
    <div style="font-size:10px; color:#adb5bd; margin-top:3px;">Completed-month recap &nbsp;\u2022&nbsp; Data sourced from SoftPro</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { html, subject: `Your ${recapLabel} Final Numbers`, repTotal, closings };
}

/** Same recipient list as the daily rep email. */
async function recapRecipients() {
  const { rows } = await pool.query(
    "SELECT sales_rep, email FROM rep_manager_assignments WHERE email IS NOT NULL AND email != '' AND is_active = true ORDER BY sales_rep"
  );
  return rows;
}

/** Send recaps for a completed month. Skips reps with $0 total (no zero-recap). */
async function sendRepRecaps(recapMonth) {
  const reps = await recapRecipients();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const r of reps) {
    try {
      const { html, subject, repTotal } = await buildRepRecapHtml(r.sales_rep, recapMonth);
      if (!repTotal || repTotal <= 0) { results.push({ rep: r.sales_rep, skipped: 'zero total' }); continue; }
      await sgMail.send({ to: r.email, from, subject, html });
      results.push({ rep: r.sales_rep, sentTo: r.email, sent: true, total: repTotal });
    } catch (err) {
      results.push({ rep: r.sales_rep, sent: false, error: err.message });
    }
  }
  return results;
}

/** Test send — everything routes to testEmail, banner shows intended rep. Skips $0. */
async function sendRepRecapsTest(recapMonth, testEmail) {
  const reps = await recapRecipients();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const to = testEmail || 'ghernandez@pct.com';
  const results = [];
  for (const r of reps) {
    try {
      const { html, subject, repTotal } = await buildRepRecapHtml(r.sales_rep, recapMonth);
      if (!repTotal || repTotal <= 0) { results.push({ rep: r.sales_rep, skipped: 'zero total' }); continue; }
      const banner = `<div style="background:#fef3c7; color:#92400e; padding:12px 20px; text-align:center; font-family:Arial,sans-serif; font-size:13px; font-weight:600;">\u26a0\ufe0f TEST \u2014 would go to ${r.sales_rep} at ${r.email}</div>`;
      await sgMail.send({ to, from, subject: `[TEST \u2192 ${r.sales_rep}] ${subject}`, html: banner + html });
      results.push({ rep: r.sales_rep, sent: true, total: repTotal });
    } catch (err) {
      results.push({ rep: r.sales_rep, sent: false, error: err.message });
    }
  }
  return results;
}

module.exports = { buildRepRecapHtml, sendRepRecaps, sendRepRecapsTest };
