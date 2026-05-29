'use client';

import { useState, useEffect } from 'react';
import { api, formatCurrency } from '../lib/api';

export default function ReconciliationBar({ month, year }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!month || !year) return;
    setError(null);
    api(`/api/reports/reconciliation?month=${month}&year=${year}`)
      .then(setData)
      .catch(err => setError(err.message));
  }, [month, year]);

  // Reset to collapsed whenever the month/year changes
  useEffect(() => { setExpanded(false); }, [month, year]);

  if (error || !data) return null;

  const { titleOfficerTotal, dailyRevenueTotal, escrowTotal, tsgTotal, grandTotal, rankingTotal,
          titleOrders, escrowOrders, tsgOrders, totalOrders, reconciled, rankingMatch } = data;
  const titleRev = titleOfficerTotal ?? dailyRevenueTotal ?? 0;
  const tsg = tsgTotal ?? 0;

  const ok = reconciled && rankingMatch;
  const icon = ok ? '✓' : '✗';
  const label = ok ? 'Numbers Reconciled' : 'Revenue Mismatch Detected';

  if (!expanded) {
    return (
      <div
        className={`reconciliation-collapsed ${ok ? '' : 'unreconciled'}`}
        onClick={() => setExpanded(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true); } }}
        aria-expanded="false"
      >
        <span className="reconciliation-status">
          <span className="reconciliation-icon">{icon}</span> {label}
        </span>
        <span className="reconciliation-summary">
          {formatCurrency(grandTotal)} total · {totalOrders} orders
        </span>
        <span className="reconciliation-chevron">▼</span>
      </div>
    );
  }

  const bg = ok ? '#f0fdf4' : '#fef2f2';
  const border = ok ? '#86efac' : '#fca5a5';
  const topBorder = ok ? '#22c55e' : '#ef4444';
  const iconColor = ok ? '#16a34a' : '#dc2626';

  return (
    <div
      onClick={() => setExpanded(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(false); } }}
      aria-expanded="true"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderTop: `3px solid ${topBorder}`,
        borderRadius: '10px',
        padding: '16px 24px',
        margin: '12px 24px 16px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: '12px', fontWeight: 600, color: iconColor }}>
        <span><span style={{ fontSize: '14px' }}>{icon}</span> {label}</span>
        <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>▲ click to collapse</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
        <Column label="Title Officer Revenue" value={formatCurrency(titleRev)} sub={`${titleOrders} orders`} />
        <Operator>+</Operator>
        <Column label="Escrow Revenue" value={formatCurrency(escrowTotal)} sub={`${escrowOrders} orders`} />
        <Operator>+</Operator>
        <Column label="TSG Revenue" value={formatCurrency(tsg)} sub={`${tsgOrders ?? 0} orders`} />
        <Operator>=</Operator>
        <Column label="Grand Total" value={formatCurrency(grandTotal)} sub={`${totalOrders} orders`} accent />
        <Operator>=</Operator>
        <Column
          label="R-14 Total"
          value={formatCurrency(rankingTotal)}
          sub={rankingMatch ? '✓ Match' : `✗ Off by ${formatCurrency(Math.abs(grandTotal - rankingTotal))}`}
          matchColor={rankingMatch ? '#16a34a' : '#dc2626'}
        />
      </div>
      {!reconciled && (
        <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>
          ⚠️ Title Officer ({formatCurrency(titleRev)}) + Escrow ({formatCurrency(escrowTotal)}) + TSG ({formatCurrency(tsg)}) = {formatCurrency(titleRev + escrowTotal + tsg)} but Grand Total = {formatCurrency(grandTotal)}. Difference: {formatCurrency(Math.abs((titleRev + escrowTotal + tsg) - grandTotal))}
        </div>
      )}
    </div>
  );
}

function Column({ label, value, sub, accent, matchColor }) {
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: accent ? '#03374f' : '#374151', lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: '11px', color: matchColor || '#9ca3af' }}>{sub}</div>
    </div>
  );
}

function Operator({ children }) {
  return (
    <div style={{ fontSize: '16px', fontWeight: 600, color: '#9ca3af', flexShrink: 0, paddingTop: '10px', padding: '10px 8px 0' }}>
      {children}
    </div>
  );
}
