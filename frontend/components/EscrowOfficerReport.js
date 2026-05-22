'use client';

import { useState, useEffect } from 'react';
import { api, formatCurrency, formatPercent } from '../lib/api';

export default function EscrowOfficerReport({ month, year }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api(`/api/reports/escrow-officer-production?month=${month}&year=${year}`)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [month, year]);

  if (loading) return <div className="loading-spinner"><div className="spinner" />Loading report...</div>;
  if (error) return <div className="error-banner"><strong>Error:</strong> {error}</div>;
  if (!data || !data.report) return <p style={{ color: '#868e96', padding: '40px 0', textAlign: 'center' }}>No data available.</p>;

  const { report, dates } = data;
  const branches = Object.keys(report).sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });

  return (
    <div>
      <div className="report-meta">
        <span><span className="label">Period:</span> {dates.selectedMonthLabel}</span>
        <span><span className="label">Today =</span> {dates.yesterday}</span>
        <span><span className="label">Prior:</span> {dates.priorMonthLabel}</span>
        <span style={{ color: '#f26b2b', fontWeight: 600 }}>Escrow fee revenue grouped by escrow officer · any file with escrow_revenue</span>
      </div>

      <div className="report-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="report-table">
          <thead>
            <tr>
              <th className="text-left">Escrow Officer</th>
              <th className="col-escrow">Today Cnt</th><th className="col-escrow">Today Rev</th>
              <th className="col-escrow">MTD Cnt</th><th className="col-escrow">MTD Rev</th>
              <th className="col-escrow">Prior Cnt</th><th className="col-escrow">Prior Rev</th>
              <th className="col-ratio">Open (4m)</th><th className="col-ratio">Close (4m)</th><th className="col-ratio">Ratio</th>
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

function BranchSection({ branch, officers }) {
  // Sort officers within each branch by MTD revenue descending
  const officerNames = Object.keys(officers).sort((a, b) => {
    const ra = officers[a].mtd_rev || 0;
    const rb = officers[b].mtd_rev || 0;
    if (rb !== ra) return rb - ra;
    return a.localeCompare(b);
  });

  let totalCreated = 0, totalClosed = 0;
  const sub = officerNames.reduce((a, n) => {
    const r = officers[n];
    a.today_cnt += r.today_cnt; a.today_rev += r.today_rev;
    a.mtd_cnt += r.mtd_cnt; a.mtd_rev += r.mtd_rev;
    a.prior_cnt += r.prior_cnt; a.prior_rev += r.prior_rev;
    totalCreated += r.created_4m || 0;
    totalClosed += r.closed_4m || 0;
    return a;
  }, { today_cnt: 0, today_rev: 0, mtd_cnt: 0, mtd_rev: 0, prior_cnt: 0, prior_rev: 0 });

  const branchRatio = totalCreated > 0
    ? (totalClosed / totalCreated * 100).toFixed(1) + '%'
    : '—';

  return (
    <>
      <tr className="branch-header"><td colSpan={10}>{branch}</td></tr>
      {officerNames.map(name => {
        const r = officers[name];
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
        <td className="text-left" style={{ paddingLeft: '16px' }}>{branch} Total</td>
        <td>{sub.today_cnt || ''}</td>
        <td>{sub.today_rev ? formatCurrency(sub.today_rev) : ''}</td>
        <td>{sub.mtd_cnt || ''}</td>
        <td>{sub.mtd_rev ? formatCurrency(sub.mtd_rev) : ''}</td>
        <td>{sub.prior_cnt || ''}</td>
        <td>{sub.prior_rev ? formatCurrency(sub.prior_rev) : ''}</td>
        <td>{totalCreated || ''}</td>
        <td>{totalClosed || ''}</td>
        <td>{branchRatio}</td>
      </tr>
    </>
  );
}
