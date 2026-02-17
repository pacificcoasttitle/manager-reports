'use client';

import { formatCurrency, formatPercent } from '../lib/api';

const CATEGORIES = ['Purchase', 'Refinance', 'Escrow'];

const CATEGORY_CLASSES = {
  'Purchase': 'col-purchase',
  'Refinance': 'col-refi',
  'Escrow': 'col-escrow',
  'TSG': 'col-tsg'
};

export default function R14BranchesReport({ data }) {
  if (!data || !data.report) return <p style={{ color: '#868e96', padding: '40px 0', textAlign: 'center' }}>No data available.</p>;

  const { report, dates } = data;
  const branches = Object.keys(report);

  return (
    <div>
      <div className="report-meta">
        <span><span className="label">Period:</span> {dates.selectedMonthLabel}</span>
        <span><span className="label">Today =</span> {dates.yesterday}</span>
        <span><span className="label">Prior:</span> {dates.priorMonthLabel}</span>
      </div>

      <div className="report-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="report-table">
          <thead>
            <tr>
              <th rowSpan={2} className="text-left">Sales Rep</th>
              {CATEGORIES.map(cat => (
                <th key={cat} colSpan={6} className={CATEGORY_CLASSES[cat]} style={{ textAlign: 'center' }}>
                  {cat}
                </th>
              ))}
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
              <th className="col-ratio">Open</th><th className="col-ratio">Close</th><th className="col-ratio">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {branches.map(branch => (
              <BranchSection key={branch} branch={branch} reps={report[branch]} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fragment({ children }) { return <>{children}</>; }

function BranchSection({ branch, reps }) {
  const repNames = Object.keys(reps).sort();
  return (
    <>
      <tr className="branch-header"><td colSpan={22}>{branch}</td></tr>
      {repNames.map(rep => {
        const e = reps[rep];
        return (
          <tr key={`${branch}-${rep}`}>
            <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{rep}</td>
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
            <td>{e.created_4m || ''}</td>
            <td>{e.closed_4m || ''}</td>
            <td>{e.closing_ratio ? formatPercent(e.closing_ratio) : ''}</td>
          </tr>
        );
      })}
    </>
  );
}
