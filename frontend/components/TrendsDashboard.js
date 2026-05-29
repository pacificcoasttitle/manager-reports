'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';

// Brand palette for known series; anything else falls back to FALLBACK_COLORS by index.
const SERIES_COLORS = {
  Total: '#f26b2b',
  Glendale: '#03374f',
  Orange: '#f26b2b',
  'Inland Empire': '#7c3aed',
  Porterville: '#059669',
  TSG: '#6b7280',
  Purchase: '#2563eb',
  Refinance: '#d97706',
  Escrow: '#059669',
};
const FALLBACK_COLORS = ['#03374f', '#f26b2b', '#2563eb', '#059669', '#7c3aed', '#d97706', '#6b7280', '#db2777'];

function colorFor(series, index) {
  return SERIES_COLORS[series] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function formatCurrency(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(0) + 'K';
  return '$' + Math.round(n).toLocaleString();
}

function formatMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m) - 1]} '${y.slice(2)}`;
}

export default function TrendsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [productType, setProductType] = useState('all');
  const [breakdown, setBreakdown] = useState('none');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ product: productType, breakdown });
    api(`/api/reports/trends?${params}`)
      .then(json => { if (!cancelled) setData(json); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productType, breakdown]);

  if (error) return <div className="error-banner"><strong>Error:</strong> {error}</div>;
  if (loading || !data) return <div className="loading-spinner"><div className="spinner" />Loading trends...</div>;

  const renderChart = (chartData, title, isRevenue) => {
    const series = (chartData && chartData.series) || [];
    const rows = (chartData && chartData.data) || [];
    return (
      <div style={{ marginBottom: 32, background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#03374f', marginBottom: 16 }}>{title}</h3>
        {rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#868e96' }}>No data for this selection.</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={rows} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f5" />
              <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 12, fill: '#868e96' }} axisLine={{ stroke: '#dee2e6' }} />
              <YAxis tickFormatter={isRevenue ? formatCurrency : (v) => v} tick={{ fontSize: 12, fill: '#868e96' }} axisLine={{ stroke: '#dee2e6' }} width={isRevenue ? 60 : 40} />
              <Tooltip
                formatter={(value) => isRevenue ? formatCurrency(value) : Number(value).toLocaleString()}
                labelFormatter={formatMonth}
                contentStyle={{ borderRadius: 8, border: '1px solid #dee2e6', fontSize: 13 }}
              />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {series.map((s, i) => (
                <Line key={s} type="monotone" dataKey={s} stroke={colorFor(s, i)} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  };

  const kpi = data.kpi || {};
  const pct = (v) => v == null ? '—' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%`;
  const pctColor = (v) => v == null ? '#03374f' : (v >= 0 ? '#059669' : '#dc2626');

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 12, color: '#868e96', marginRight: 6 }}>Product:</label>
          <select value={productType} onChange={e => setProductType(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}>
            <option value="all">All</option>
            <option value="Purchase">Purchase</option>
            <option value="Refinance">Refinance</option>
            <option value="Escrow">Escrow</option>
            <option value="TSG">TSG</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#868e96', marginRight: 6 }}>Breakdown:</label>
          <select value={breakdown} onChange={e => setBreakdown(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}>
            <option value="none">Total</option>
            <option value="branch">By Branch</option>
            <option value="product">By Product Type</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="MTD Revenue" value={formatCurrency(kpi.mtdRevenue)} />
        <KpiCard label="vs Prior Month" value={pct(kpi.priorChangePct)} color={pctColor(kpi.priorChangePct)} />
        <KpiCard label="YTD Revenue" value={formatCurrency(kpi.ytdRevenue)} />
        <KpiCard label="vs Last Year" value={pct(kpi.lastYearChangePct)} color={pctColor(kpi.lastYearChangePct)} />
      </div>

      {renderChart(data.revenue, 'Revenue — Month over Month', true)}
      {renderChart(data.openOrders, 'Open Orders — Month over Month', false)}
      {renderChart(data.closedOrders, 'Closed Orders — Month over Month', false)}
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 12, color: '#868e96', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || '#03374f' }}>{value}</div>
    </div>
  );
}
