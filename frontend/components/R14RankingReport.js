'use client';

import { formatCurrency, formatPercent } from '../lib/api';

export default function R14RankingReport({ data }) {
  if (!data || !data.ranking) return <p style={{ color: '#868e96', padding: '40px 0', textAlign: 'center' }}>No data available.</p>;

  const { ranking, dates } = data;

  return (
    <div>
      <div className="report-meta">
        <span><span className="label">Period:</span> {dates.selectedMonthLabel}</span>
        <span><span className="label">Working Days:</span> {dates.workedDays} worked / {dates.remainingWorkingDays} remaining</span>
      </div>

      <div className="report-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="report-table">
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>#</th>
              <th className="text-left">Sales Rep</th>
              <th>Today Cnt</th>
              <th>Today Rev</th>
              <th>MTD Cnt</th>
              <th>MTD Rev</th>
              <th style={{ color: '#f26b2b' }}>Projected</th>
              <th>Prior Cnt</th>
              <th>Prior Rev</th>
              <th className="col-ratio">Open (4m)</th>
              <th className="col-ratio">Close (4m)</th>
              <th className="col-ratio">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((rep, i) => (
              <tr key={rep.sales_rep}>
                <td className="rank-col">{i + 1}</td>
                <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{rep.sales_rep}</td>
                <td>{rep.today_cnt || ''}</td>
                <td>{rep.today_rev ? formatCurrency(rep.today_rev) : ''}</td>
                <td>{rep.mtd_cnt || ''}</td>
                <td style={{ fontWeight: 600 }}>{formatCurrency(rep.mtd_rev)}</td>
                <td className="projected-col">{formatCurrency(rep.projected_rev)}</td>
                <td>{rep.prior_cnt || ''}</td>
                <td>{rep.prior_rev ? formatCurrency(rep.prior_rev) : ''}</td>
                <td>{rep.created_4m || ''}</td>
                <td>{rep.closed_4m || ''}</td>
                <td>{rep.closing_ratio ? formatPercent(rep.closing_ratio) : ''}</td>
              </tr>
            ))}
            <tr className="grand-total-row">
              <td></td>
              <td className="text-left">TOTAL</td>
              <td>{ranking.reduce((s, r) => s + r.today_cnt, 0) || ''}</td>
              <td>{formatCurrency(ranking.reduce((s, r) => s + r.today_rev, 0))}</td>
              <td>{ranking.reduce((s, r) => s + r.mtd_cnt, 0)}</td>
              <td>{formatCurrency(ranking.reduce((s, r) => s + r.mtd_rev, 0))}</td>
              <td className="projected-col">{formatCurrency(ranking.reduce((s, r) => s + r.projected_rev, 0))}</td>
              <td>{ranking.reduce((s, r) => s + r.prior_cnt, 0)}</td>
              <td>{formatCurrency(ranking.reduce((s, r) => s + r.prior_rev, 0))}</td>
              <td></td><td></td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
