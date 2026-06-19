require('dotenv').config();
const { Client } = require('pg');

const Q = [
  ['1. API: sum branch grand totals from /api/reports/daily-revenue (May 2026)',
    null, async (c) => {
      const reports = require('../lib/reports');
      const data = await reports.dailyRevenue(5, 2026);
      const rows = [];
      let grandMtd = 0;
      for (const branch of Object.keys(data.report)) {
        const t = data.report[branch].totals || {};
        rows.push({ branch, mtd_closed: t.mtd_closed || 0, mtd_rev: +(t.mtd_rev || 0).toFixed(2) });
        grandMtd += t.mtd_rev || 0;
      }
      rows.push({ branch: 'SUM(branch totals)', mtd_closed: '', mtd_rev: +grandMtd.toFixed(2) });
      rows.push({ branch: 'data.grandTotal.mtd_rev', mtd_closed: data.grandTotal.mtd_closed, mtd_rev: +data.grandTotal.mtd_rev.toFixed(2) });
      console.table(rows);
    }],
  ['2. SQL: Title Revenue tab expected per-branch (officer-mapped, T+UW+TSG > 0)',
    `SELECT COALESCE(tob.branch,'Unassigned') AS branch,
       COUNT(*) AS orders,
       ROUND(SUM(os.title_revenue)::numeric,2) AS title_rev,
       ROUND(SUM(os.underwriter_revenue)::numeric,2) AS uw_rev,
       ROUND(SUM(os.tsg_revenue)::numeric,2) AS tsg_rev,
       ROUND(SUM(os.title_revenue+os.underwriter_revenue+os.tsg_revenue)::numeric,2) AS title_tab_total
     FROM order_summary os
     LEFT JOIN title_officer_branches tob ON os.title_officer=tob.officer_name AND tob.is_active=true
     WHERE os.fetch_month='2026-05'
       AND (os.title_revenue+os.underwriter_revenue+os.tsg_revenue) > 0
     GROUP BY tob.branch ORDER BY title_tab_total DESC;`],
  ['3. Reconciliation endpoint computation (all orders, no revenue filter)',
    `SELECT ROUND(SUM(title_revenue+underwriter_revenue)::numeric,2) AS title_uw_total,
            ROUND(SUM(tsg_revenue)::numeric,2) AS tsg_total,
            ROUND(SUM(title_revenue+underwriter_revenue+tsg_revenue)::numeric,2) AS combined_total
     FROM order_summary WHERE fetch_month='2026-05';`],
  ['4. Orders with revenue but NO title_officer mapping (these would land in Unassigned)',
    `SELECT COALESCE(NULLIF(os.title_officer,''),'(null)') AS title_officer,
       COUNT(*) AS orders,
       ROUND(SUM(os.title_revenue+os.underwriter_revenue+os.tsg_revenue)::numeric,2) AS title_tsg_rev
     FROM order_summary os
     LEFT JOIN title_officer_branches tob ON os.title_officer=tob.officer_name AND tob.is_active=true
     WHERE os.fetch_month='2026-05'
       AND tob.officer_name IS NULL
       AND (os.title_revenue+os.underwriter_revenue+os.tsg_revenue) > 0
     GROUP BY os.title_officer ORDER BY title_tsg_rev DESC;`],
  ['5. Expected Title Revenue tab grand total (T+UW+TSG > 0)',
    `SELECT ROUND(SUM(title_revenue+underwriter_revenue+tsg_revenue)::numeric,2) AS expected_title_tab_total,
       COUNT(*) AS orders
     FROM order_summary
     WHERE fetch_month='2026-05'
       AND (title_revenue+underwriter_revenue+tsg_revenue) > 0;`],
  ['6. Per-branch breakdown (same as #2, with totals row)',
    `WITH per_branch AS (
       SELECT COALESCE(tob.branch,'Unassigned') AS branch,
         SUM(os.title_revenue+os.underwriter_revenue+os.tsg_revenue) AS total
       FROM order_summary os
       LEFT JOIN title_officer_branches tob ON os.title_officer=tob.officer_name AND tob.is_active=true
       WHERE os.fetch_month='2026-05'
         AND (os.title_revenue+os.underwriter_revenue+os.tsg_revenue) > 0
       GROUP BY tob.branch)
     SELECT branch, ROUND(total::numeric,2) AS branch_total FROM per_branch
     UNION ALL
     SELECT 'GRAND TOTAL', ROUND(SUM(total)::numeric,2) FROM per_branch
     ORDER BY branch_total DESC NULLS LAST;`],
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const [name, sql, fn] of Q) {
    console.log('\n=== ' + name + ' ===');
    try {
      if (fn) { await fn(c); continue; }
      const r = await c.query(sql);
      r.rows.length ? console.table(r.rows) : console.log('(no rows)');
    } catch (e) { console.log('ERROR:', e.message); }
  }
  await c.end();
  process.exit(0);
})();
