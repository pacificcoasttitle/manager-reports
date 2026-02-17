'use client';

import { formatCurrency, formatPercent } from '../lib/api';

export default function R14RankingReport({ data }) {
  if (!data || !data.ranking) return <p className="text-gray-500 p-4">No data available.</p>;

  const { ranking, dates } = data;

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-sm text-gray-600">
        <span className="font-medium">Period:</span> {dates.selectedMonthLabel} &nbsp;|&nbsp;
        <span className="font-medium">Working Days:</span> {dates.workedDays} worked / {dates.remainingWorkingDays} remaining
      </div>

      <table className="report-table">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th className="text-left">Sales Rep</th>
            <th>Today Cnt</th>
            <th>Today Rev</th>
            <th>MTD Cnt</th>
            <th>MTD Rev</th>
            <th>Projected Rev</th>
            <th>Prior Cnt</th>
            <th>Prior Rev</th>
            <th>Created (4m)</th>
            <th>Closed (4m)</th>
            <th>Closing Ratio</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((rep, i) => (
            <tr key={rep.sales_rep}>
              <td className="text-center font-medium">{i + 1}</td>
              <td className="text-left whitespace-nowrap">{rep.sales_rep}</td>
              <td>{rep.today_cnt || ''}</td>
              <td>{rep.today_rev ? formatCurrency(rep.today_rev) : ''}</td>
              <td>{rep.mtd_cnt || ''}</td>
              <td className="font-semibold">{formatCurrency(rep.mtd_rev)}</td>
              <td className="text-blue-600">{formatCurrency(rep.projected_rev)}</td>
              <td>{rep.prior_cnt || ''}</td>
              <td>{rep.prior_rev ? formatCurrency(rep.prior_rev) : ''}</td>
              <td>{rep.created_4m || ''}</td>
              <td>{rep.closed_4m || ''}</td>
              <td>{rep.closing_ratio ? formatPercent(rep.closing_ratio) : ''}</td>
            </tr>
          ))}

          {/* Totals */}
          <tr className="grand-total-row">
            <td></td>
            <td className="text-left font-bold">TOTAL</td>
            <td>{ranking.reduce((s, r) => s + r.today_cnt, 0) || ''}</td>
            <td>{formatCurrency(ranking.reduce((s, r) => s + r.today_rev, 0))}</td>
            <td>{ranking.reduce((s, r) => s + r.mtd_cnt, 0)}</td>
            <td>{formatCurrency(ranking.reduce((s, r) => s + r.mtd_rev, 0))}</td>
            <td>{formatCurrency(ranking.reduce((s, r) => s + r.projected_rev, 0))}</td>
            <td>{ranking.reduce((s, r) => s + r.prior_cnt, 0)}</td>
            <td>{formatCurrency(ranking.reduce((s, r) => s + r.prior_rev, 0))}</td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
