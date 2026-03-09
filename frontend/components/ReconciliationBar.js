'use client';

import { useState, useEffect } from 'react';
import { api, formatCurrency } from '../lib/api';

export default function ReconciliationBar({ month, year }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!month || !year) return;
    setError(null);
    api(`/api/reports/reconciliation?month=${month}&year=${year}`)
      .then(setData)
      .catch(err => setError(err.message));
  }, [month, year]);

  if (error || !data) return null;

  const { dailyRevenueTotal, escrowTotal, grandTotal, rankingTotal,
          titleOrders, escrowOrders, totalOrders, reconciled, rankingMatch } = data;

  const ok = reconciled && rankingMatch;
  const bg = ok ? '#f0fdf4' : '#fef2f2';
  const border = ok ? '#86efac' : '#fca5a5';
  const topBorder = ok ? '#22c55e' : '#ef4444';
  const icon = ok ? '✓' : '✗';
  const iconColor = ok ? '#16a34a' : '#dc2626';
  const label = ok ? 'Numbers Reconciled' : 'Revenue Mismatch Detected';

  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderTop: `3px solid ${topBorder}`,
      borderRadius: '10px',
      padding: '16px 24px',
      margin: '20px 24px 16px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: iconColor }}>
        <span style={{ fontSize: '14px' }}>{icon}</span> {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <Column label="Title Business" value={formatCurrency(dailyRevenueTotal)} sub={`${titleOrders} orders`} />
        <Operator>+</Operator>
        <Column label="Escrow Business" value={formatCurrency(escrowTotal)} sub={`${escrowOrders} orders`} />
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
          ⚠️ Daily ({formatCurrency(dailyRevenueTotal)}) + Escrow ({formatCurrency(escrowTotal)}) = {formatCurrency(dailyRevenueTotal + escrowTotal)} but Grand Total = {formatCurrency(grandTotal)}. Difference: {formatCurrency(Math.abs((dailyRevenueTotal + escrowTotal) - grandTotal))}
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
