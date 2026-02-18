'use client';

import { formatCurrency, formatPercent } from '../lib/api';

const CATEGORIES = ['Purchase', 'Refinance'];

const CATEGORY_CLASSES = {
  'Purchase': 'col-purchase',
  'Refinance': 'col-refi',
};

export default function TitleOfficerReport({ data }) {
  if (!data || !data.report) return <p style={{ color: '#868e96', padding: '40px 0', textAlign: 'center' }}>No data available.</p>;

  const { report, dates } = data;
  const branches = Object.keys(report);

  return (
    <div>
      <div className="report-meta">
        <span><span className="label">Period:</span> {dates.selectedMonthLabel}</span>
        <span><span className="label">Today =</span> {dates.yesterday}</span>
        <span><span className="label">Prior:</span> {dates.priorMonthLabel}</span>
        <span style={{ color: '#f26b2b', fontWeight: 600 }}>Purchase & Refinance · Title Revenue Only</span>
      </div>

      <div className="report-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="report-table">
          <thead>
            <tr>
              <th rowSpan={2} className="text-left">Title Officer</th>
              {CATEGORIES.map(cat => (
                <th key={cat} colSpan={6} className={CATEGORY_CLASSES[cat]} style={{ textAlign: 'center' }}>
                  {cat}
                </th>
              ))}
              <th colSpan={3} style={{ textAlign: 'center' }}>Total Revenue</th>
              <th colSpan={3} className="col-ratio" style={{ textAlign: 'center' }}>Closing Ratio</th>
            </tr>
            <tr>
              {CATEGORIES.map(cat => (
                <Fragment key={cat}>
                  <th className={CATEGORY_CLASSES[cat]}>T.Cnt</th>
                  <th className={CATEGORY_CLASSES[cat]}>T.Rev</th>
                  <th className={CATEGORY_CLASSES[cat]}>M.Cnt</th>
                  <th className={CATEGORY_CLASSES[cat]}>M.Rev</th>
                  <th className={CATEGORY_CLASSES[cat]}>P.Cnt</th>
                  <th className={CATEGORY_CLASSES[cat]}>P.Rev</th>
                </Fragment>
              ))}
              <th>Today</th><th>MTD</th><th>Prior</th>
              <th className="col-ratio">Open</th><th className="col-ratio">Close</th><th className="col-ratio">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {branches.map(branch => (
              <BranchSection key={branch} branch={branch} officers={report[branch]} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fragment({ children }) { return <>{children}</>; }

function BranchSection({ branch, officers }) {
  const names = Object.keys(officers).sort();

  // Compute branch subtotals
  const branchTotal = {};
  let totalToday = 0, totalMTD = 0, totalPrior = 0;
  let branchTotalCreated = 0, branchTotalClosed = 0;
  names.forEach(name => {
    const e = officers[name];
    CATEGORIES.forEach(cat => {
      if (!branchTotal[cat]) branchTotal[cat] = { today_cnt: 0, today_rev: 0, mtd_cnt: 0, mtd_rev: 0, prior_cnt: 0, prior_rev: 0 };
      if (e[cat]) {
        branchTotal[cat].today_cnt += e[cat].today_cnt || 0;
        branchTotal[cat].today_rev += e[cat].today_rev || 0;
        branchTotal[cat].mtd_cnt += e[cat].mtd_cnt || 0;
        branchTotal[cat].mtd_rev += e[cat].mtd_rev || 0;
        branchTotal[cat].prior_cnt += e[cat].prior_cnt || 0;
        branchTotal[cat].prior_rev += e[cat].prior_rev || 0;
      }
    });
    totalToday += e.totals?.today_rev || 0;
    totalMTD += e.totals?.mtd_rev || 0;
    totalPrior += e.totals?.prior_rev || 0;
    branchTotalCreated += e.created_4m || 0;
    branchTotalClosed += e.closed_4m || 0;
  });

  const branchRatio = branchTotalCreated > 0
    ? (branchTotalClosed / branchTotalCreated * 100).toFixed(1) + '%'
    : '—';

  return (
    <>
      <tr className="branch-header"><td colSpan={18}>{branch}</td></tr>
      {names.map(name => {
        const e = officers[name];
        return (
          <tr key={`${branch}-${name}`}>
            <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{name}</td>
            {CATEGORIES.map(cat => {
              const d = e[cat];
              return (
                <Fragment key={cat}>
                  <td>{d.today_cnt || ''}</td>
                  <td>{d.today_rev ? formatCurrency(d.today_rev) : ''}</td>
                  <td>{d.mtd_cnt || ''}</td>
                  <td>{d.mtd_rev ? formatCurrency(d.mtd_rev) : ''}</td>
                  <td>{d.prior_cnt || ''}</td>
                  <td>{d.prior_rev ? formatCurrency(d.prior_rev) : ''}</td>
                </Fragment>
              );
            })}
            <td>{e.totals.today_rev ? formatCurrency(e.totals.today_rev) : ''}</td>
            <td>{e.totals.mtd_rev ? formatCurrency(e.totals.mtd_rev) : ''}</td>
            <td>{e.totals.prior_rev ? formatCurrency(e.totals.prior_rev) : ''}</td>
            <td>{e.created_4m || ''}</td>
            <td>{e.closed_4m || ''}</td>
            <td>{e.closing_ratio ? formatPercent(e.closing_ratio) : ''}</td>
          </tr>
        );
      })}
      <tr className="subtotal-row">
        <td className="text-left" style={{ paddingLeft: '16px' }}>{branch} Total</td>
        {CATEGORIES.map(cat => {
          const t = branchTotal[cat] || {};
          return (
            <Fragment key={cat}>
              <td>{t.today_cnt || ''}</td>
              <td>{t.today_rev ? formatCurrency(t.today_rev) : ''}</td>
              <td>{t.mtd_cnt || ''}</td>
              <td>{t.mtd_rev ? formatCurrency(t.mtd_rev) : ''}</td>
              <td>{t.prior_cnt || ''}</td>
              <td>{t.prior_rev ? formatCurrency(t.prior_rev) : ''}</td>
            </Fragment>
          );
        })}
        <td>{totalToday ? formatCurrency(totalToday) : ''}</td>
        <td>{totalMTD ? formatCurrency(totalMTD) : ''}</td>
        <td>{totalPrior ? formatCurrency(totalPrior) : ''}</td>
        <td>{branchTotalCreated || ''}</td>
        <td>{branchTotalClosed || ''}</td>
        <td>{branchRatio}</td>
      </tr>
    </>
  );
}
