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

const LOGO_URL = 'https://manager-reports-one.vercel.app/logo2.png';

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

  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const reportDate = `${dayNames[yesterday.getDay()]}, ${monthNames[month]} ${yesterday.getDate()}, ${year}`;
  const firstName = managerName.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f5f5f5; font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center" style="padding:20px 10px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <tr><td style="background-color:#03374f; background-image:linear-gradient(135deg,#03374f 0%,#064a6b 100%); padding:28px 30px 22px;">
          <img src="${LOGO_URL}" alt="Pacific Coast Title" height="34" style="display:block; height:34px; width:auto; border:0; outline:none; margin-bottom:14px;">
          <div style="font-size:12px; color:#8db4d4; font-weight:600; letter-spacing:1.2px; text-transform:uppercase;">Team Production Report</div>
        </td></tr>
        <tr><td style="height:4px; line-height:4px; font-size:0; background-color:#f26b2b;">&nbsp;</td></tr>

        <tr><td style="padding:24px 30px 8px;">
          <div style="font-size:16px; color:#03374f; font-weight:600;">Good morning, ${firstName}</div>
          <div style="font-size:13px; color:#868e96; margin-top:4px;">${reportDate} \u00b7 ${repData.length} reps on your team</div>
        </td></tr>

        <tr><td style="padding:16px 30px 8px;">
          <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:12px; border-left:3px solid #f26b2b; padding-left:10px;">Team Summary</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr style="background:#f8f9fa;">
              <td style="padding:10px;"></td>
              <td align="center" style="padding:10px; font-weight:600; color:#495057;">Yesterday</td>
              <td align="center" style="padding:10px; font-weight:600; color:#495057;">MTD</td>
            </tr>
            <tr>
              <td style="padding:8px 10px; color:#495057;">Opens</td>
              <td align="center" style="padding:8px 10px;">${teamYdayOpens}</td>
              <td align="center" style="padding:8px 10px; font-weight:600;">${teamMtdOpens}</td>
            </tr>
            <tr>
              <td style="padding:8px 10px; color:#495057;">Closings</td>
              <td align="center" style="padding:8px 10px;">${teamYdayCnt}</td>
              <td align="center" style="padding:8px 10px; font-weight:600;">${teamMtdCnt}</td>
            </tr>
            <tr style="background:#fff8f0;">
              <td style="padding:10px; color:#03374f; font-weight:700;">Revenue</td>
              <td align="center" style="padding:10px; font-weight:600;">${fmt(teamYdayRev)}</td>
              <td align="center" style="padding:10px; font-weight:700; color:#f26b2b; font-size:15px;">${fmt(teamMtdRev)}</td>
            </tr>
            <tr>
              <td style="padding:8px 10px; color:#868e96; font-size:12px;">Prior Month</td>
              <td align="center" style="padding:8px 10px;"></td>
              <td align="center" style="padding:8px 10px; color:#868e96; font-size:12px;">${fmt(teamPriorRev)}</td>
            </tr>
            <tr>
              <td style="padding:8px 10px; color:#868e96; font-size:12px;">Share of Company</td>
              <td align="center" style="padding:8px 10px;"></td>
              <td align="center" style="padding:8px 10px; color:#868e96; font-size:12px;">${teamShare}%</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:16px 30px 8px;">
          <div style="font-size:14px; font-weight:700; color:#03374f; margin-bottom:12px; border-left:3px solid #f26b2b; padding-left:10px;">Your Reps (MTD)</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr style="background:#f8f9fa;">
              <td style="padding:8px 10px; font-weight:600; color:#495057;">Rep</td>
              <td align="center" style="padding:8px 6px; font-weight:600; color:#495057;">Opens</td>
              <td align="center" style="padding:8px 6px; font-weight:600; color:#495057;">Closed</td>
              <td align="right" style="padding:8px 10px; font-weight:600; color:#495057;">Revenue</td>
            </tr>
            ${repData.map(r => `
            <tr style="border-bottom:1px solid #f1f3f5;">
              <td style="padding:8px 10px; color:#03374f;">${r.name}</td>
              <td align="center" style="padding:8px 6px;">${r.mtdOpens}</td>
              <td align="center" style="padding:8px 6px;">${r.mtdCnt}</td>
              <td align="right" style="padding:8px 10px; font-weight:600;">${fmt(r.mtdRev)}</td>
            </tr>`).join('')}
          </table>
        </td></tr>

        <tr><td style="padding:24px 30px; text-align:center;">
          <a href="https://manager-reports-one.vercel.app" style="display:inline-block; background:#f26b2b; color:#fff; font-size:13px; font-weight:600; text-decoration:none; padding:10px 28px; border-radius:6px;">Open Dashboard \u2192</a>
        </td></tr>

        <tr><td style="padding:0 30px 26px; text-align:center;">
          <div style="font-size:12px; font-weight:700; color:#03374f; letter-spacing:0.3px;">Pacific Coast Title</div>
          <div style="font-size:11px; color:#adb5bd; margin-top:3px;">Your team's production \u00b7 Generated automatically</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  return { html, subject: `Your Team's Production \u2014 ${monthNames[month]} ${yesterday.getDate()}`, hasData: true };
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
