'use client';

import { formatCurrency, formatPercent } from '../lib/api';

export default function EscrowProductionReport({ data }) {
  if (!data || !data.report) return <p style={{ color: '#868e96', padding: '40px 0', textAlign: 'center' }}>No data available.</p>;

  const { report, dates } = data;
  const branches = Object.keys(report);

  return (
    <div>
      <div className="report-meta">
        <span><span className="label">Period:</span> {dates.selectedMonthLabel}</span>
        <span><span className="label">Today =</span> {dates.yesterday}</span>
        <span><span className="label">Prior:</span> {dates.priorMonthLabel}</span>
        <span style={{ color: '#f26b2b', fontWeight: 600 }}>Title & Escrow orders only</span>
      </div>

      <div className="report-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="report-table">
          <thead>
            <tr>
              <th className="text-left">Sales Rep</th>
              <th>Today Cnt</th><th>Today Rev</th>
              <th>MTD Cnt</th><th>MTD Rev</th>
              <th>Prior Cnt</th><th>Prior Rev</th>
              <th className="col-ratio">Open (4m)</th><th className="col-ratio">Close (4m)</th><th className="col-ratio">Ratio</th>
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

function BranchSection({ branch, reps }) {
  const repNames = Object.keys(reps).sort();
  const sub = repNames.reduce((a, n) => {
    const r = reps[n];
    a.today_cnt += r.today_cnt; a.today_rev += r.today_rev;
    a.mtd_cnt += r.mtd_cnt; a.mtd_rev += r.mtd_rev;
    a.prior_cnt += r.prior_cnt; a.prior_rev += r.prior_rev;
    return a;
  }, { today_cnt: 0, today_rev: 0, mtd_cnt: 0, mtd_rev: 0, prior_cnt: 0, prior_rev: 0 });

  return (
    <>
      <tr className="branch-header"><td colSpan={10}>{branch}</td></tr>
      {repNames.map(name => {
        const r = reps[name];
        return (
          <tr key={`${branch}-${name}`}>
            <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{name}</td>
            <td>{r.today_cnt || ''}</td>
            <td>{r.today_rev ? formatCurrency(r.today_rev) : ''}</td>
            <td>{r.mtd_cnt || ''}</td>
            <td>{r.mtd_rev ? formatCurrency(r.mtd_rev) : ''}</td>
            <td>{r.prior_cnt || ''}</td>
            <td>{r.prior_rev ? formatCurrency(r.prior_rev) : ''}</td>
            <td>{r.created_4m || ''}</td>
            <td>{r.closed_4m || ''}</td>
            <td>{r.closing_ratio ? formatPercent(r.closing_ratio) : ''}</td>
          </tr>
        );
      })}
      <tr className="subtotal-row">
        <td className="text-left">{branch} Subtotal</td>
        <td>{sub.today_cnt || ''}</td>
        <td>{sub.today_rev ? formatCurrency(sub.today_rev) : ''}</td>
        <td>{sub.mtd_cnt || ''}</td>
        <td>{sub.mtd_rev ? formatCurrency(sub.mtd_rev) : ''}</td>
        <td>{sub.prior_cnt || ''}</td>
        <td>{sub.prior_rev ? formatCurrency(sub.prior_rev) : ''}</td>
        <td></td><td></td><td></td>
      </tr>
    </>
  );
}
