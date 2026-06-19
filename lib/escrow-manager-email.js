/**
 * Daily escrow team rollup for the escrow manager.
 * Shows each active escrow officer's commissionable production (officer base)
 * and the team total. Revenue = officer_commissionable_escrow scoped by
 * escrow_revenue > 0 (matches the per-officer emails). Recipients live in
 * escrow_managers. Wired into the 5 AM cron behind escrow_manager_emails_enabled.
 */

const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const LOGO_URL = 'https://www.pct.com/logo2-dark.png';
const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');

async function buildEscrowManagerEmailHtml(managerName) {
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const yesterday = new Date(pacificNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const year = yesterday.getFullYear();
  const month = yesterday.getMonth() + 1;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;

  // The team = all active escrow officers
  const { rows: officers } = await pool.query(
    "SELECT officer_name FROM officer_email_recipients WHERE officer_type = 'escrow' AND is_active = true ORDER BY officer_name"
  );
  const officerNames = officers.map(o => o.officer_name);
  if (officerNames.length === 0) {
    return { html: null, subject: null, hasData: false };
  }

  const [{ rows: mtdRows }, { rows: ydayRows }, { rows: priorRows }, { rows: wd }] = await Promise.all([
    pool.query(`
      SELECT escrow_officer,
        COUNT(*) FILTER (WHERE officer_commissionable_escrow > 0) as files,
        ROUND(SUM(officer_commissionable_escrow)::numeric, 2) as mtd
      FROM order_summary
      WHERE escrow_officer = ANY($1) AND fetch_month = $2 AND escrow_revenue > 0
      GROUP BY escrow_officer
    `, [officerNames, yearMonth]),

    pool.query(`
      SELECT escrow_officer, ROUND(SUM(officer_commissionable_escrow)::numeric, 2) as rev
      FROM order_summary
      WHERE escrow_officer = ANY($1) AND transaction_date::date = $2::date AND escrow_revenue > 0
      GROUP BY escrow_officer
    `, [officerNames, yesterdayStr]),

    pool.query(`
      SELECT escrow_officer, ROUND(SUM(officer_commissionable_escrow)::numeric, 2) as rev
      FROM order_summary
      WHERE escrow_officer = ANY($1) AND fetch_month = $2 AND escrow_revenue > 0
      GROUP BY escrow_officer
    `, [officerNames, priorMonth]),

    pool.query(`
      SELECT COUNT(*) FILTER (WHERE d <= $2::date) as worked, COUNT(*) as total
      FROM generate_series($1::date, (date_trunc('month', $1::date) + interval '1 month - 1 day')::date, '1 day') d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    `, [`${yearMonth}-01`, yesterdayStr]),
  ]);

  const mtdMap = {}; mtdRows.forEach(r => mtdMap[r.escrow_officer] = r);
  const ydayMap = {}; ydayRows.forEach(r => ydayMap[r.escrow_officer] = parseFloat(r.rev));
  const priorMap = {}; priorRows.forEach(r => priorMap[r.escrow_officer] = parseFloat(r.rev));

  const officerData = officerNames.map(name => ({
    name,
    files: mtdMap[name] ? parseInt(mtdMap[name].files) : 0,
    mtd: mtdMap[name] ? parseFloat(mtdMap[name].mtd) : 0,
    yday: ydayMap[name] || 0,
    prior: priorMap[name] || 0,
  })).sort((a, b) => b.mtd - a.mtd);

  const teamMtd = officerData.reduce((s, o) => s + o.mtd, 0);
  const teamYday = officerData.reduce((s, o) => s + o.yday, 0);
  const teamPrior = officerData.reduce((s, o) => s + o.prior, 0);
  const teamFiles = officerData.reduce((s, o) => s + o.files, 0);
  const pctChange = teamPrior > 0 ? Math.round(((teamMtd - teamPrior) / teamPrior) * 100) : null;

  const worked = parseInt(wd[0].worked);
  const totalDays = parseInt(wd[0].total);
  const remaining = Math.max(0, totalDays - worked);
  const projected = worked > 0 ? (teamMtd / worked) * totalDays : 0;
  const progressPct = projected > 0 ? Math.min(100, Math.round((teamMtd / projected) * 100)) : 0;

  const day = yesterday.getDate();
  const priorMonthName = monthNames[parseInt(priorMonth.split('-')[1])];
  const reportDate = `${dayNames[yesterday.getDay()]}, ${monthNames[month]} ${day}, ${year}`;
  const firstName = managerName.split(' ')[0];

  const trendHtml = pctChange === null
    ? `<span style="color:#868e96;">\u2014 vs prior month</span>`
    : pctChange >= 0
      ? `<span style="color:#2f9e44;">\u25b2 ${pctChange}% vs prior month</span>`
      : `<span style="color:#e03131;">\u25bc ${Math.abs(pctChange)}% vs prior month</span>`;

  // Reconciliation guard: per-officer MTD must sum to the team total
  const rowSum = officerData.reduce((s, o) => s + o.mtd, 0);
  if (Math.abs(rowSum - teamMtd) >= 0.01) {
    console.warn(`[escrow-manager-email] ${managerName}: officer rows ${rowSum} != team total ${teamMtd}`);
  }

  const officerRowsHtml = officerData.map((o, i) => {
    const isTop = i === 0 && o.mtd > 0;
    const quiet = o.files === 0 && o.mtd === 0;
    const nameColor = quiet ? '#adb5bd' : '#03374f';
    const numColor = quiet ? '#adb5bd' : '#495057';
    const revColor = quiet ? '#adb5bd' : '#03374f';
    return `<tr style="${isTop ? 'background-color:#fff8f0;' : ''}">
      <td style="padding:8px 10px; color:${nameColor}; border-bottom:1px solid #f1f3f5;">${isTop ? '\u25b2 ' : ''}${o.name}</td>
      <td align="center" style="padding:8px 6px; color:${numColor}; border-bottom:1px solid #f1f3f5;">${o.files}</td>
      <td align="right" style="padding:8px 10px; font-weight:700; color:${revColor}; border-bottom:1px solid #f1f3f5;">${fmt(o.mtd)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f0f2f5; font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;">
<tr><td align="center" style="padding:24px 12px;">

<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.10);">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#03374f 0%,#055a7e 100%); padding:26px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="top">
        <img src="${LOGO_URL}" alt="Pacific Coast Title" height="30" style="display:block; height:30px; width:auto; border:0; outline:none; margin-bottom:12px;">
        <div style="font-size:11px; font-weight:600; color:#8db4d4; letter-spacing:2px; text-transform:uppercase;">Escrow Team Production</div>
        <div style="font-size:20px; font-weight:700; color:#ffffff; margin-top:4px; letter-spacing:-0.3px;">Good morning, ${firstName}</div>
      </td>
      <td align="right" valign="top"><div style="font-size:12px; color:#8db4d4; white-space:nowrap;">${reportDate}<br>${officerData.length} officers on your team</div></td>
    </tr></table>
  </td></tr>

  <!-- HERO: TEAM MTD COMMISSIONABLE -->
  <tr><td style="padding:30px 32px 14px; text-align:center;">
    <div style="font-size:12px; color:#868e96; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Team Commissionable Escrow \u2014 Month-to-Date</div>
    <div style="font-size:42px; font-weight:700; color:#03374f; margin:8px 0; letter-spacing:-1px;">${fmt(teamMtd)}</div>
    <div style="font-size:14px; font-weight:600;">${trendHtml}</div>
  </td></tr>

  <!-- PROGRESS BAR -->
  <tr><td style="padding:6px 32px 22px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:12px; color:#868e96;">MTD: ${fmt(teamMtd)}</td>
      <td align="right" style="font-size:12px; color:#868e96;">Projected: ${fmt(projected)}</td>
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#e9ecef; border-radius:10px; margin-top:6px;">
      <tr><td width="${progressPct}%" style="background-color:#f26b2b; height:10px; border-radius:10px; font-size:0; line-height:0;">&nbsp;</td><td style="font-size:0; line-height:0;">&nbsp;</td></tr>
    </table>
    <div style="font-size:11px; color:#adb5bd; margin-top:6px; text-align:center;">Day ${worked} of ${totalDays} working days \u00b7 ${remaining} remaining</div>
  </td></tr>

  <!-- TEAM SUMMARY -->
  <tr><td style="padding:4px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">Team Summary</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; border-collapse:collapse;">
      <tr style="background-color:#f8f9fa;">
        <td style="padding:8px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;"></td>
        <td align="center" style="padding:8px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Yesterday</td>
        <td align="center" style="padding:8px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">MTD</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">Files</td>
        <td align="center" style="padding:8px; border-bottom:1px solid #f1f3f5;">\u2014</td>
        <td align="center" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${teamFiles}</td>
      </tr>
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 8px; color:#03374f; font-weight:700; border-top:2px solid #dee2e6;">Commissionable</td>
        <td align="center" style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">${fmt(teamYday)}</td>
        <td align="center" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(teamMtd)}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#868e96; font-size:12px;">${priorMonthName} (prior month)</td>
        <td colspan="2" align="right" style="padding:8px; color:#868e96; font-size:12px; font-weight:600;">${fmt(teamPrior)}${pctChange !== null ? ` &nbsp;<span style="color:${pctChange >= 0 ? '#2f9e44' : '#e03131'};">${pctChange >= 0 ? '\u25b2' : '\u25bc'} ${Math.abs(pctChange)}%</span>` : ''}</td>
      </tr>
    </table>
  </td></tr>

  <!-- YOUR OFFICERS -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">Your Officers \u2014 MTD Commissionable</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; border-collapse:collapse;">
      <tr style="background-color:#f8f9fa;">
        <td style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Officer</td>
        <td align="center" style="padding:8px 6px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Files</td>
        <td align="right" style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Commissionable</td>
      </tr>
      ${officerRowsHtml}
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 10px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Team Total</td>
        <td align="center" style="padding:9px 6px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">${teamFiles}</td>
        <td align="right" style="padding:9px 10px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(teamMtd)}</td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:14px 32px 0;">&nbsp;</td></tr>

  <!-- FOOTER -->
  <tr><td style="background-color:#f8f9fa; padding:16px 32px; text-align:center; border-top:1px solid #e9ecef;">
    <div style="font-size:10px; color:#adb5bd; letter-spacing:0.5px;">PACIFIC COAST TITLE COMPANY &nbsp;\u2022&nbsp; ESCROW TEAM PRODUCTION</div>
    <div style="font-size:10px; color:#adb5bd; margin-top:3px;">Data sourced from SoftPro &nbsp;\u2022&nbsp; Auto-generated nightly</div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

  return { html, subject: `Escrow Team Production \u2014 ${monthNames[month]} ${day}`, hasData: officerData.length > 0 };
}

async function getActiveEscrowManagers() {
  const { rows } = await pool.query(
    "SELECT manager_name, email FROM escrow_managers WHERE is_active = true AND email != 'PLACEHOLDER'"
  );
  return rows;
}

async function sendEscrowManagerEmails() {
  const mgrs = await getActiveEscrowManagers();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const m of mgrs) {
    try {
      const { html, subject, hasData } = await buildEscrowManagerEmailHtml(m.manager_name);
      if (!hasData) { results.push({ manager: m.manager_name, sent: false, reason: 'no officers' }); continue; }
      await sgMail.send({ to: m.email, from, subject, html });
      results.push({ manager: m.manager_name, sentTo: m.email, sent: true });
    } catch (err) {
      console.error(`Failed to send to ${m.manager_name}:`, err.message);
      results.push({ manager: m.manager_name, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendEscrowManagerEmailsTest(testEmail) {
  const { rows: mgrs } = await pool.query("SELECT manager_name, email FROM escrow_managers WHERE is_active = true");
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const m of mgrs) {
    try {
      const { html, subject, hasData } = await buildEscrowManagerEmailHtml(m.manager_name);
      if (!hasData) { results.push({ manager: m.manager_name, sent: false, reason: 'no officers' }); continue; }
      const banner = `<div style="background:#fef3c7; color:#92400e; padding:12px 20px; text-align:center; font-family:Arial,sans-serif; font-size:13px; font-weight:600;">\u26a0\ufe0f TEST \u2192 This email would be sent to ${m.manager_name} at ${m.email}</div>`;
      await sgMail.send({
        to: testEmail,
        from,
        subject: `[TEST \u2192 ${m.manager_name}] ${subject}`,
        html: banner + html,
      });
      results.push({ manager: m.manager_name, sentTo: testEmail, sent: true });
    } catch (err) {
      console.error(`Test send failed for ${m.manager_name}:`, err.message);
      results.push({ manager: m.manager_name, sent: false, error: err.message });
    }
  }
  return results;
}

module.exports = { buildEscrowManagerEmailHtml, sendEscrowManagerEmails, sendEscrowManagerEmailsTest, getActiveEscrowManagers };
