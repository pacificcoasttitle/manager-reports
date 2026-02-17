'use client';

import { formatCurrency, formatPercent } from '../lib/api';

const CATEGORIES = ['Purchase', 'Refinance'];

export default function TitleOfficerReport({ data }) {
  if (!data || !data.report) return <p className="text-gray-500 p-4">No data available.</p>;

  const { report, dates } = data;
  const branches = Object.keys(report);

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-sm text-gray-600">
        <span className="font-medium">Period:</span> {dates.selectedMonthLabel} &nbsp;|&nbsp;
        <span className="font-medium">Today = </span>{dates.yesterday} &nbsp;|&nbsp;
        <span className="font-medium">Prior:</span> {dates.priorMonthLabel} &nbsp;|&nbsp;
        <span className="text-orange-600 font-medium">Purchase & Refinance only</span>
      </div>

      <table className="report-table">
        <thead>
          <tr>
            <th rowSpan={2}>Title Officer</th>
            {CATEGORIES.map(cat => (
              <th key={cat} colSpan={6} className="text-center">{cat}</th>
            ))}
            <th colSpan={3} className="text-center bg-gray-600">Total Revenue</th>
            <th colSpan={3} className="text-center bg-yellow-700">Closing Ratio</th>
          </tr>
          <tr>
            {CATEGORIES.map(cat => (
              <>
                <th key={`${cat}-tc`}>Today Cnt</th>
                <th key={`${cat}-tr`}>Today Rev</th>
                <th key={`${cat}-mc`}>MTD Cnt</th>
                <th key={`${cat}-mr`}>MTD Rev</th>
                <th key={`${cat}-pc`}>Prior Cnt</th>
                <th key={`${cat}-pr`}>Prior Rev</th>
              </>
            ))}
            <th className="bg-gray-600">Today</th>
            <th className="bg-gray-600">MTD</th>
            <th className="bg-gray-600">Prior</th>
            <th className="bg-yellow-700">Created</th>
            <th className="bg-yellow-700">Closed</th>
            <th className="bg-yellow-700">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {branches.map(branch => (
            <BranchSection key={branch} branch={branch} officers={report[branch]} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BranchSection({ branch, officers }) {
  const names = Object.keys(officers).sort();

  return (
    <>
      <tr>
        <td colSpan={18} className="branch-header">{branch}</td>
      </tr>
      {names.map(name => {
        const entry = officers[name];
        return (
          <tr key={`${branch}-${name}`}>
            <td className="text-left whitespace-nowrap">{name}</td>
            {CATEGORIES.map(cat => {
              const d = entry[cat];
              return (
                <>
                  <td key={`${cat}-tc`}>{d.today_cnt || ''}</td>
                  <td key={`${cat}-tr`}>{d.today_rev ? formatCurrency(d.today_rev) : ''}</td>
                  <td key={`${cat}-mc`}>{d.mtd_cnt || ''}</td>
                  <td key={`${cat}-mr`}>{d.mtd_rev ? formatCurrency(d.mtd_rev) : ''}</td>
                  <td key={`${cat}-pc`}>{d.prior_cnt || ''}</td>
                  <td key={`${cat}-pr`}>{d.prior_rev ? formatCurrency(d.prior_rev) : ''}</td>
                </>
              );
            })}
            <td>{entry.totals.today_rev ? formatCurrency(entry.totals.today_rev) : ''}</td>
            <td>{entry.totals.mtd_rev ? formatCurrency(entry.totals.mtd_rev) : ''}</td>
            <td>{entry.totals.prior_rev ? formatCurrency(entry.totals.prior_rev) : ''}</td>
            <td>{entry.created_4m || ''}</td>
            <td>{entry.closed_4m || ''}</td>
            <td>{entry.closing_ratio ? formatPercent(entry.closing_ratio) : ''}</td>
          </tr>
        );
      })}
    </>
  );
}
