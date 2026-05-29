'use client';

import { useState, useEffect } from 'react';
import { api, formatPercent } from '../lib/api';

// Generic "Openings" view shared by every production report's Openings sub-tab.
// Renders counts of orders received (pipeline) — no revenue columns.
// Expects: data.report = { branch: { rowKey: { today_cnt, mtd_cnt, prior_cnt, created_4m, closed_4m, closing_ratio } } }
export default function OpeningsReport({ endpoint, month, year, entityLabel = 'Name' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api(`${endpoint}?month=${month}&year=${year}`)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [endpoint, month, year]);

  if (loading) return <div className="loading-spinner"><div className="spinner" />Loading openings...</div>;
  if (error) return <div className="error-banner"><strong>Error:</strong> {error}</div>;
  if (!data || !data.report) return <p style={{ color: '#868e96', padding: '40px 0', textAlign: 'center' }}>No data available.</p>;

  const { report, dates, meta } = data;
  const label = (meta && meta.entityLabel) || entityLabel;
  const noRatio = !!(meta && meta.noRatio);
  const branches = Object.keys(report).sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });

  if (branches.length === 0) {
    return (
      <div>
        <OpeningsMeta dates={dates} />
        <div className="empty-state" style={{ color: '#868e96', padding: '40px 0', textAlign: 'center' }}>
          <p>No openings recorded for this period.</p>
        </div>
      </div>
    );
  }

  const colCount = noRatio ? 4 : 7;

  // Grand total
  const grand = { today_cnt: 0, mtd_cnt: 0, prior_cnt: 0, created_4m: 0, closed_4m: 0 };
  for (const b of branches) {
    for (const k of Object.keys(report[b])) {
      const r = report[b][k];
      grand.today_cnt += r.today_cnt; grand.mtd_cnt += r.mtd_cnt; grand.prior_cnt += r.prior_cnt;
      grand.created_4m += r.created_4m || 0; grand.closed_4m += r.closed_4m || 0;
    }
  }
  const grandRatio = grand.created_4m > 0 ? (grand.closed_4m / grand.created_4m * 100).toFixed(1) + '%' : '—';

  return (
    <div>
      <OpeningsMeta dates={dates} />
      <div className="report-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="report-table">
          <thead>
            <tr>
              <th className="text-left">{label}</th>
              <th className="col-escrow">Today Cnt</th>
              <th className="col-escrow">MTD Cnt</th>
              <th className="col-escrow">Prior Cnt</th>
              {!noRatio && <th className="col-ratio">Open (4m)</th>}
              {!noRatio && <th className="col-ratio">Close (4m)</th>}
              {!noRatio && <th className="col-ratio">Ratio</th>}
            </tr>
          </thead>
          <tbody>
            {branches.map(branch => (
              <BranchSection key={branch} branch={branch} rows={report[branch]} noRatio={noRatio} colCount={colCount} />
            ))}
            <tr className="subtotal-row" style={{ fontWeight: 700 }}>
              <td className="text-left">Grand Total</td>
              <td>{grand.today_cnt || ''}</td>
              <td>{grand.mtd_cnt || ''}</td>
              <td>{grand.prior_cnt || ''}</td>
              {!noRatio && <td>{grand.created_4m || ''}</td>}
              {!noRatio && <td>{grand.closed_4m || ''}</td>}
              {!noRatio && <td>{grandRatio}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OpeningsMeta({ dates }) {
  return (
    <div className="report-meta">
      <span><span className="label">Period:</span> {dates.selectedMonthLabel}</span>
      <span><span className="label">Today =</span> {dates.yesterday}</span>
      <span><span className="label">Prior:</span> {dates.priorMonthLabel}</span>
      <span style={{ color: '#f26b2b', fontWeight: 600 }}>Opens received (pipeline) · counts only — revenue is recognized at close</span>
    </div>
  );
}

function BranchSection({ branch, rows, noRatio, colCount }) {
  const names = Object.keys(rows).sort((a, b) => {
    const ma = rows[a].mtd_cnt || 0;
    const mb = rows[b].mtd_cnt || 0;
    if (mb !== ma) return mb - ma;
    return a.localeCompare(b);
  });

  let totalCreated = 0, totalClosed = 0;
  const sub = names.reduce((a, n) => {
    const r = rows[n];
    a.today_cnt += r.today_cnt; a.mtd_cnt += r.mtd_cnt; a.prior_cnt += r.prior_cnt;
    totalCreated += r.created_4m || 0; totalClosed += r.closed_4m || 0;
    return a;
  }, { today_cnt: 0, mtd_cnt: 0, prior_cnt: 0 });

  const branchRatio = totalCreated > 0 ? (totalClosed / totalCreated * 100).toFixed(1) + '%' : '—';

  return (
    <>
      <tr className="branch-header"><td colSpan={colCount}>{branch}</td></tr>
      {names.map(name => {
        const r = rows[name];
        return (
          <tr key={`${branch}-${name}`}>
            <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{name}</td>
            <td>{r.today_cnt || ''}</td>
            <td>{r.mtd_cnt || ''}</td>
            <td>{r.prior_cnt || ''}</td>
            {!noRatio && <td>{r.created_4m || ''}</td>}
            {!noRatio && <td>{r.closed_4m || ''}</td>}
            {!noRatio && <td>{r.closing_ratio ? formatPercent(r.closing_ratio) : ''}</td>}
          </tr>
        );
      })}
      <tr className="subtotal-row">
        <td className="text-left" style={{ paddingLeft: '16px' }}>{branch} Total</td>
        <td>{sub.today_cnt || ''}</td>
        <td>{sub.mtd_cnt || ''}</td>
        <td>{sub.prior_cnt || ''}</td>
        {!noRatio && <td>{totalCreated || ''}</td>}
        {!noRatio && <td>{totalClosed || ''}</td>}
        {!noRatio && <td>{branchRatio}</td>}
      </tr>
    </>
  );
}
