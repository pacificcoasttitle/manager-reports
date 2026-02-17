const sgMail = require('@sendgrid/mail');
const pool = require('../database/pool');
const reports = require('./reports');

async function getEmailConfig() {
  const { rows } = await pool.query('SELECT * FROM email_settings WHERE id = 1');
  return rows[0] || null;
}

async function getRecipients(reportId = null) {
  let query = 'SELECT * FROM email_recipients WHERE is_active = true';
  const { rows } = await pool.query(query);

  if (reportId) {
    return rows.filter(r => {
      const rpts = r.reports || [];
      return rpts.includes(reportId);
    });
  }
  return rows;
}

async function sendReportEmail(reportId, month, year) {
  const config = await getEmailConfig();
  if (!config || !config.is_active || !config.sendgrid_api_key) {
    throw new Error('Email not configured or inactive');
  }

  sgMail.setApiKey(config.sendgrid_api_key);

  const recipients = await getRecipients(reportId);
  if (recipients.length === 0) {
    throw new Error('No active recipients for this report');
  }

  // Generate report data
  let data;
  let reportName;
  switch (reportId) {
    case 'daily-revenue':
      data = await reports.dailyRevenue(month, year);
      reportName = 'Daily Revenue';
      break;
    case 'r14-ranking':
      data = await reports.r14Ranking(month, year);
      reportName = 'R-14 Ranking';
      break;
    case 'r14-branches':
      data = await reports.r14Branches(month, year);
      reportName = 'R-14 Branches';
      break;
    case 'title-officer':
      data = await reports.titleOfficerProduction(month, year);
      reportName = 'Title Officer Production';
      break;
    case 'escrow':
      data = await reports.escrowProduction(month, year);
      reportName = 'Escrow Production';
      break;
    default:
      throw new Error(`Unknown report: ${reportId}`);
  }

  const html = buildEmailHtml(reportId, reportName, data, month, year);

  const results = [];
  for (const recipient of recipients) {
    try {
      await sgMail.send({
        to: recipient.email,
        from: { email: config.from_email, name: config.from_name },
        subject: `PCT ${reportName} — ${data.dates?.selectedMonthLabel || `${month}/${year}`}`,
        html: html
      });
      results.push({ email: recipient.email, status: 'sent' });
    } catch (err) {
      results.push({ email: recipient.email, status: 'failed', error: err.message });
    }
  }

  return results;
}

function buildEmailHtml(reportId, reportName, data, month, year) {
  const dates = data.dates || {};

  let summaryHtml = '';

  if (reportId === 'daily-revenue' && data.grandTotal) {
    const gt = data.grandTotal;
    summaryHtml = `
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr>
          <td style="padding:16px;background:#f8f9fa;border-radius:8px;text-align:center;width:25%;">
            <div style="font-size:11px;color:#868e96;text-transform:uppercase;font-weight:600;">MTD Revenue</div>
            <div style="font-size:22px;font-weight:700;color:#03374f;">$${(gt.mtd_rev || 0).toLocaleString()}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:16px;background:#f8f9fa;border-radius:8px;text-align:center;width:25%;">
            <div style="font-size:11px;color:#868e96;text-transform:uppercase;font-weight:600;">MTD Closed</div>
            <div style="font-size:22px;font-weight:700;color:#03374f;">${gt.mtd_closed || 0}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:16px;background:#f8f9fa;border-radius:8px;text-align:center;width:25%;">
            <div style="font-size:11px;color:#868e96;text-transform:uppercase;font-weight:600;">Prior Revenue</div>
            <div style="font-size:22px;font-weight:700;color:#03374f;">$${(gt.prior_rev || 0).toLocaleString()}</div>
          </td>
        </tr>
      </table>`;
  }

  if (reportId === 'r14-ranking' && data.ranking) {
    const top5 = data.ranking.slice(0, 5);
    let rows = top5.map((r, i) => `
      <tr style="border-bottom:1px solid #e9ecef;">
        <td style="padding:8px 12px;font-weight:600;color:#868e96;">${i + 1}</td>
        <td style="padding:8px 12px;">${r.sales_rep}</td>
        <td style="padding:8px 12px;text-align:right;">${r.mtd_cnt}</td>
        <td style="padding:8px 12px;text-align:right;font-weight:600;">$${(r.mtd_rev || 0).toLocaleString()}</td>
        <td style="padding:8px 12px;text-align:right;color:#f26b2b;font-weight:600;">$${(r.projected_rev || 0).toLocaleString()}</td>
      </tr>`).join('');

    summaryHtml = `
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
        <tr style="background:#03374f;color:white;">
          <th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;">#</th>
          <th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;">Sales Rep</th>
          <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;">MTD Cnt</th>
          <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;">MTD Rev</th>
          <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;">Projected</th>
        </tr>
        ${rows}
      </table>`;
  }

  return `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#03374f;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h1 style="margin:0;color:white;font-size:18px;font-weight:700;">PCT ${reportName}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.6);font-size:12px;">${dates.selectedMonthLabel || ''} | Working Days: ${dates.workedDays || 0} of ${dates.totalWorkingDays || 0}</p>
        </div>
        <div style="background:white;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #e9ecef;border-top:none;">
          ${summaryHtml}
          <p style="font-size:13px;color:#495057;margin:16px 0 0;">
            View the full report on the <a href="${process.env.FRONTEND_URL || 'https://manager-reports.vercel.app'}" style="color:#f26b2b;font-weight:600;">PCT Reports Dashboard</a>.
          </p>
        </div>
        <p style="text-align:center;font-size:11px;color:#adb5bd;margin-top:16px;">Pacific Coast Title — Management Reports</p>
      </div>
    </body>
    </html>`;
}

module.exports = { sendReportEmail, getEmailConfig, getRecipients };
