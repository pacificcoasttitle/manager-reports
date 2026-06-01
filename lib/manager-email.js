/**
 * Per-manager daily email for Sales Managers.
 * Each active manager gets a daily email showing only the reps assigned to them
 * (rep_manager_assignments): team summary, their reps ranked by MTD revenue, and
 * the team's share of company revenue. Revenue = total_revenue (all the rep's
 * business). Sent individually; no manager sees another team's detail.
 */

const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const LOGO_URL = 'https://www.pct.com/logo2-dark.png';

async function buildManagerEmailHtml(managerName) {
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const yesterday = new Date(pacificNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const year = yesterday.getFullYear();
  const month = yesterday.getMonth() + 1;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const priorMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;

  const { rows: repRows } = await pool.query(
    'SELECT sales_rep FROM rep_manager_assignments WHERE manager_name = $1',
    [managerName]
  );
  const reps = repRows.map(r => r.sales_rep);
  if (reps.length === 0) {
    return { html: null, subject: null, hasData: false };
  }

  const [{ rows: mtdRows }, { rows: openRows }, { rows: ydayRows }, { rows: ydayOpenRows }, { rows: priorRows }, { rows: companyRows }] = await Promise.all([
    pool.query(`
      SELECT sales_rep, COUNT(*) as mtd_cnt, ROUND(SUM(total_revenue)::numeric, 2) as mtd_rev
      FROM order_summary
      WHERE sales_rep = ANY($1) AND fetch_month = $2
      GROUP BY sales_rep
    `, [reps, yearMonth]),

    pool.query(`
      SELECT sales_rep, COUNT(*) as mtd_opens
      FROM open_orders
      WHERE sales_rep = ANY($1) AND open_month = $2 AND file_number NOT ILIKE 'test%'
      GROUP BY sales_rep
    `, [reps, yearMonth]),

    pool.query(`
      SELECT sales_rep, COUNT(*) as cnt, ROUND(SUM(total_revenue)::numeric, 2) as rev
      FROM order_summary
      WHERE sales_rep = ANY($1) AND transaction_date::date = $2::date
      GROUP BY sales_rep
    `, [reps, yesterdayStr]),

    pool.query(`
      SELECT sales_rep, COUNT(*) as opens
      FROM open_orders
      WHERE sales_rep = ANY($1) AND received_date::date = $2::date AND file_number NOT ILIKE 'test%'
      GROUP BY sales_rep
    `, [reps, yesterdayStr]),

    pool.query(`
      SELECT sales_rep, ROUND(SUM(total_revenue)::numeric, 2) as prior_rev
      FROM order_summary
      WHERE sales_rep = ANY($1) AND fetch_month = $2
      GROUP BY sales_rep
    `, [reps, priorMonth]),

    pool.query(`
      SELECT ROUND(SUM(total_revenue)::numeric, 2) as company_rev
      FROM order_summary WHERE fetch_month = $1
    `, [yearMonth]),
  ]);

  const mtdMap = {}; mtdRows.forEach(r => mtdMap[r.sales_rep] = r);
  const openMap = {}; openRows.forEach(r => openMap[r.sales_rep] = parseInt(r.mtd_opens));
  const ydayMap = {}; ydayRows.forEach(r => ydayMap[r.sales_rep] = r);
  const ydayOpenMap = {}; ydayOpenRows.forEach(r => ydayOpenMap[r.sales_rep] = parseInt(r.opens));
  const priorMap = {}; priorRows.forEach(r => priorMap[r.sales_rep] = parseFloat(r.prior_rev));

  const repData = reps.map(rep => ({
    name: rep,
    ydayCnt: ydayMap[rep] ? parseInt(ydayMap[rep].cnt) : 0,
    ydayRev: ydayMap[rep] ? parseFloat(ydayMap[rep].rev) : 0,
    ydayOpens: ydayOpenMap[rep] || 0,
    mtdCnt: mtdMap[rep] ? parseInt(mtdMap[rep].mtd_cnt) : 0,
    mtdRev: mtdMap[rep] ? parseFloat(mtdMap[rep].mtd_rev) : 0,
    mtdOpens: openMap[rep] || 0,
    priorRev: priorMap[rep] || 0,
  })).sort((a, b) => b.mtdRev - a.mtdRev);

  const teamMtdRev = repData.reduce((s, r) => s + r.mtdRev, 0);
  const teamMtdCnt = repData.reduce((s, r) => s + r.mtdCnt, 0);
  const teamMtdOpens = repData.reduce((s, r) => s + r.mtdOpens, 0);
  const teamYdayRev = repData.reduce((s, r) => s + r.ydayRev, 0);
  const teamYdayCnt = repData.reduce((s, r) => s + r.ydayCnt, 0);
  const teamYdayOpens = repData.reduce((s, r) => s + r.ydayOpens, 0);
  const teamPriorRev = repData.reduce((s, r) => s + r.priorRev, 0);
  const companyRev = parseFloat(companyRows[0].company_rev) || 0;
  const teamShare = companyRev > 0 ? Math.round((teamMtdRev / companyRev) * 100) : 0;

  // Working days for projection + team rank among managers
  const [{ rows: wd }, { rows: teamRows }] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE d <= $2::date) as worked, COUNT(*) as total
      FROM generate_series($1::date, (date_trunc('month', $1::date) + interval '1 month - 1 day')::date, '1 day') d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    `, [`${yearMonth}-01`, yesterdayStr]),
    pool.query(`
      SELECT rma.manager_name, COALESCE(SUM(os.total_revenue), 0)::numeric as rev
      FROM rep_manager_assignments rma
      LEFT JOIN order_summary os ON rma.sales_rep = os.sales_rep AND os.fetch_month = $1
      GROUP BY rma.manager_name
    `, [yearMonth]),
  ]);

  const worked = parseInt(wd[0].worked);
  const totalDays = parseInt(wd[0].total);
  const remaining = Math.max(0, totalDays - worked);
  const projected = worked > 0 ? (teamMtdRev / worked) * totalDays : 0;
  const progressPct = projected > 0 ? Math.min(100, Math.round((teamMtdRev / projected) * 100)) : 0;
  const teamPctChange = teamPriorRev > 0 ? Math.round(((teamMtdRev - teamPriorRev) / teamPriorRev) * 100) : null;

  const sortedTeams = teamRows
    .map(t => ({ name: t.manager_name, rev: parseFloat(t.rev) }))
    .sort((a, b) => b.rev - a.rev);
  const rankIdx = sortedTeams.findIndex(t => t.name === managerName);
  const rank = rankIdx >= 0 ? rankIdx + 1 : 1;
  const totalManagers = sortedTeams.length || 1;

  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const day = yesterday.getDate();
  const reportDate = `${dayNames[yesterday.getDay()]}, ${monthNames[month]} ${day}, ${year}`;
  const firstName = managerName.split(' ')[0];

  const trendHtml = teamPctChange === null
    ? `<span style="color:#868e96;">\u2014 vs prior month</span>`
    : teamPctChange >= 0
      ? `<span style="color:#2f9e44;">\u25b2 ${teamPctChange}% vs prior month</span>`
      : `<span style="color:#e03131;">\u25bc ${Math.abs(teamPctChange)}% vs prior month</span>`;

  const repRowsHtml = repData.map((r, i) => {
    const isTop = i === 0 && r.mtdRev > 0;
    const quiet = r.mtdCnt === 0 && r.mtdOpens === 0 && r.mtdRev === 0;
    const nameColor = quiet ? '#adb5bd' : '#03374f';
    const numColor = quiet ? '#adb5bd' : '#495057';
    const revColor = quiet ? '#adb5bd' : '#03374f';
    return `<tr style="${isTop ? 'background-color:#fff8f0;' : ''}">
      <td style="padding:8px 10px; color:${nameColor}; border-bottom:1px solid #f1f3f5;">${isTop ? '\u25b2 ' : ''}${r.name}</td>
      <td align="center" style="padding:8px 6px; color:${numColor}; border-bottom:1px solid #f1f3f5;">${r.mtdOpens}</td>
      <td align="center" style="padding:8px 6px; color:${numColor}; border-bottom:1px solid #f1f3f5;">${r.mtdCnt}</td>
      <td align="right" style="padding:8px 10px; font-weight:700; color:${revColor}; border-bottom:1px solid #f1f3f5;">${fmt(r.mtdRev)}</td>
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
        <div style="font-size:11px; font-weight:600; color:#8db4d4; letter-spacing:2px; text-transform:uppercase;">Team Production Report</div>
        <div style="font-size:20px; font-weight:700; color:#ffffff; margin-top:4px; letter-spacing:-0.3px;">Good morning, ${firstName}</div>
      </td>
      <td align="right" valign="top"><div style="font-size:12px; color:#8db4d4; white-space:nowrap;">${reportDate}<br>${repData.length} reps on your team</div></td>
    </tr></table>
  </td></tr>

  <!-- HERO: TEAM MTD REVENUE -->
  <tr><td style="padding:30px 32px 14px; text-align:center;">
    <div style="font-size:12px; color:#868e96; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Team Revenue \u2014 Month-to-Date</div>
    <div style="font-size:42px; font-weight:700; color:#03374f; margin:8px 0; letter-spacing:-1px;">${fmt(teamMtdRev)}</div>
    <div style="font-size:14px; font-weight:600;">${trendHtml}</div>
  </td></tr>

  <!-- PROGRESS BAR -->
  <tr><td style="padding:6px 32px 22px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:12px; color:#868e96;">MTD: ${fmt(teamMtdRev)}</td>
      <td align="right" style="font-size:12px; color:#868e96;">Projected: ${fmt(projected)}</td>
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#e9ecef; border-radius:10px; margin-top:6px;">
      <tr><td width="${progressPct}%" style="background-color:#f26b2b; height:10px; border-radius:10px; font-size:0; line-height:0;">&nbsp;</td><td style="font-size:0; line-height:0;">&nbsp;</td></tr>
    </table>
    <div style="font-size:11px; color:#adb5bd; margin-top:6px; text-align:center;">Day ${worked} of ${totalDays} working days \u00b7 ${remaining} remaining</div>
  </td></tr>

  <!-- RANK BADGE -->
  <tr><td style="padding:0 32px 24px; text-align:center;">
    <span style="display:inline-block; background-color:#fff8f0; border:1px solid #f7934f; color:#9a3412; font-size:13px; font-weight:600; padding:6px 16px; border-radius:20px;">&#127942; Team Rank #${rank} of ${totalManagers} &nbsp;\u00b7&nbsp; ${teamShare}% of company</span>
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
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">Opens</td>
        <td align="center" style="padding:8px; border-bottom:1px solid #f1f3f5;">${teamYdayOpens}</td>
        <td align="center" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${teamMtdOpens}</td>
      </tr>
      <tr>
        <td style="padding:8px; color:#495057; border-bottom:1px solid #f1f3f5;">Closings</td>
        <td align="center" style="padding:8px; border-bottom:1px solid #f1f3f5;">${teamYdayCnt}</td>
        <td align="center" style="padding:8px; font-weight:700; color:#03374f; border-bottom:1px solid #f1f3f5;">${teamMtdCnt}</td>
      </tr>
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 8px; color:#03374f; font-weight:700; border-top:2px solid #dee2e6;">Revenue</td>
        <td align="center" style="padding:9px 8px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">${fmt(teamYdayRev)}</td>
        <td align="center" style="padding:9px 8px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(teamMtdRev)}</td>
      </tr>
    </table>
  </td></tr>

  <!-- YOUR REPS -->
  <tr><td style="padding:22px 32px 0;">
    <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:10px;">Your Reps \u2014 MTD</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; border-collapse:collapse;">
      <tr style="background-color:#f8f9fa;">
        <td style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Rep</td>
        <td align="center" style="padding:8px 6px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Opens</td>
        <td align="center" style="padding:8px 6px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Closed</td>
        <td align="right" style="padding:8px 10px; font-weight:600; color:#868e96; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Revenue</td>
      </tr>
      ${repRowsHtml}
      <tr style="background-color:#fff8f0;">
        <td style="padding:9px 10px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">Team Total</td>
        <td align="center" style="padding:9px 6px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">${teamMtdOpens}</td>
        <td align="center" style="padding:9px 6px; font-weight:700; color:#03374f; border-top:2px solid #dee2e6;">${teamMtdCnt}</td>
        <td align="right" style="padding:9px 10px; font-weight:700; color:#f26b2b; border-top:2px solid #dee2e6;">${fmt(teamMtdRev)}</td>
      </tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td align="center" style="padding:28px 32px 20px;">
    <a href="https://manager-reports-one.vercel.app" style="display:inline-block; background-color:#f26b2b; color:#ffffff; font-size:13px; font-weight:700; text-decoration:none; padding:13px 36px; border-radius:6px; letter-spacing:0.3px;">Open Dashboard \u2192</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background-color:#f8f9fa; padding:16px 32px; text-align:center; border-top:1px solid #e9ecef;">
    <div style="font-size:10px; color:#adb5bd; letter-spacing:0.5px;">PACIFIC COAST TITLE COMPANY &nbsp;\u2022&nbsp; TEAM PRODUCTION</div>
    <div style="font-size:10px; color:#adb5bd; margin-top:3px;">Data sourced from SoftPro &nbsp;\u2022&nbsp; Auto-generated nightly</div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

  return { html, subject: `Your Team's Production \u2014 ${monthNames[month]} ${day}`, hasData: true };
}

async function getActiveManagers() {
  const { rows } = await pool.query(
    "SELECT manager_name, email FROM sales_managers WHERE is_active = true AND email != 'PLACEHOLDER'"
  );
  return rows;
}

async function sendManagerEmails() {
  const managers = await getActiveManagers();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const mgr of managers) {
    try {
      const { html, subject, hasData } = await buildManagerEmailHtml(mgr.manager_name);
      if (!hasData) {
        results.push({ manager: mgr.manager_name, sent: false, reason: 'no reps assigned' });
        continue;
      }
      await sgMail.send({ to: mgr.email, from, subject, html });
      results.push({ manager: mgr.manager_name, sentTo: mgr.email, sent: true });
    } catch (err) {
      console.error(`Failed to send to ${mgr.manager_name}:`, err.message);
      results.push({ manager: mgr.manager_name, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendManagerEmailsTest(testEmail) {
  const managers = await getActiveManagers();
  const from = process.env.DAILY_REPORT_FROM || 'ghernandez@pct.com';
  const results = [];
  for (const mgr of managers) {
    try {
      const { html, subject, hasData } = await buildManagerEmailHtml(mgr.manager_name);
      if (!hasData) { results.push({ manager: mgr.manager_name, sent: false, reason: 'no reps' }); continue; }
      const banner = `<div style="background:#fef3c7; color:#92400e; padding:12px 20px; text-align:center; font-family:Arial,sans-serif; font-size:13px; font-weight:600;">\u26a0\ufe0f TEST \u2014 This would go to ${mgr.manager_name} at ${mgr.email}</div>`;
      await sgMail.send({
        to: testEmail,
        from,
        subject: `[TEST \u2192 ${mgr.manager_name}] ${subject}`,
        html: banner + html,
      });
      results.push({ manager: mgr.manager_name, sentTo: testEmail, sent: true });
    } catch (err) {
      console.error(`Test send failed for ${mgr.manager_name}:`, err.message);
      results.push({ manager: mgr.manager_name, sent: false, error: err.message });
    }
  }
  return results;
}

module.exports = { buildManagerEmailHtml, sendManagerEmails, sendManagerEmailsTest, getActiveManagers };
