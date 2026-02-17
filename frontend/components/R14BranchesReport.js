'use client';

import { formatCurrency, formatPercent } from '../lib/api';

const CATEGORIES = ['Purchase', 'Refinance', 'Escrow', 'TSG'];

export default function R14BranchesReport({ data }) {
  if (!data || !data.report) return <p className="text-gray-500 p-4">No data available.</p>;

  const { report, dates } = data;
  const branches = Object.keys(report);

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-sm text-gray-600">
        <span className="font-medium">Period:</span> {dates.selectedMonthLabel} &nbsp;|&nbsp;
        <span className="font-medium">Today = </span>{dates.yesterday} &nbsp;|&nbsp;
        <span className="font-medium">Prior:</span> {dates.priorMonthLabel}
      </div>

      <table className="report-table">
        <thead>
          <tr>
            <th rowSpan={2}>Sales Rep</th>
            {CATEGORIES.map(cat => (
              <th key={cat} colSpan={6} className="text-center">{cat}</th>
            ))}
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
            <th className="bg-yellow-700">Created</th>
            <th className="bg-yellow-700">Closed</th>
            <th className="bg-yellow-700">Ratio</th>
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

  return (
    <>
      <tr>
        <td colSpan={28} className="branch-header">{branch}</td>
      </tr>
      {repNames.map(rep => {
        const entry = reps[rep];
        return (
          <tr key={`${branch}-${rep}`}>
            <td className="text-left whitespace-nowrap">{rep}</td>
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
            <td>{entry.created_4m || ''}</td>
            <td>{entry.closed_4m || ''}</td>
            <td>{entry.closing_ratio ? formatPercent(entry.closing_ratio) : ''}</td>
          </tr>
        );
      })}
    </>
  );
}
