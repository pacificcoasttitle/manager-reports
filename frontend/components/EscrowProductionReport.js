'use client';

import { formatCurrency, formatPercent } from '../lib/api';

export default function EscrowProductionReport({ data }) {
  if (!data || !data.report) return <p className="text-gray-500 p-4">No data available.</p>;

  const { report, dates } = data;
  const branches = Object.keys(report);

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-sm text-gray-600">
        <span className="font-medium">Period:</span> {dates.selectedMonthLabel} &nbsp;|&nbsp;
        <span className="font-medium">Today = </span>{dates.yesterday} &nbsp;|&nbsp;
        <span className="font-medium">Prior:</span> {dates.priorMonthLabel} &nbsp;|&nbsp;
        <span className="text-orange-600 font-medium">Title & Escrow orders only</span>
      </div>

      <table className="report-table">
        <thead>
          <tr>
            <th>Sales Rep</th>
            <th>Today Cnt</th>
            <th>Today Rev</th>
            <th>MTD Cnt</th>
            <th>MTD Rev</th>
            <th>Prior Cnt</th>
            <th>Prior Rev</th>
            <th>Created (4m)</th>
            <th>Closed (4m)</th>
            <th>Closing Ratio</th>
          </tr>
        </thead>
        <tbody>
          {branches.map(branch => (
            <BranchSection key={branch} branch={branch} reps={report[branch]} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BranchSection({ branch, reps }) {
  const repNames = Object.keys(reps).sort();

  // Branch subtotals
  const subtotal = repNames.reduce((acc, name) => {
    const r = reps[name];
    acc.today_cnt += r.today_cnt;
    acc.today_rev += r.today_rev;
    acc.mtd_cnt += r.mtd_cnt;
    acc.mtd_rev += r.mtd_rev;
    acc.prior_cnt += r.prior_cnt;
    acc.prior_rev += r.prior_rev;
    return acc;
  }, { today_cnt: 0, today_rev: 0, mtd_cnt: 0, mtd_rev: 0, prior_cnt: 0, prior_rev: 0 });

  return (
    <>
      <tr>
        <td colSpan={10} className="branch-header">{branch}</td>
      </tr>
      {repNames.map(name => {
        const r = reps[name];
        return (
          <tr key={`${branch}-${name}`}>
            <td className="text-left whitespace-nowrap">{name}</td>
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
        <td>{subtotal.today_cnt || ''}</td>
        <td>{subtotal.today_rev ? formatCurrency(subtotal.today_rev) : ''}</td>
        <td>{subtotal.mtd_cnt || ''}</td>
        <td>{subtotal.mtd_rev ? formatCurrency(subtotal.mtd_rev) : ''}</td>
        <td>{subtotal.prior_cnt || ''}</td>
        <td>{subtotal.prior_rev ? formatCurrency(subtotal.prior_rev) : ''}</td>
        <td></td>
        <td></td>
        <td></td>
      </tr>
    </>
  );
}
