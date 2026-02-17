'use client';

import { useState, useEffect } from 'react';
import { api, formatCurrency } from '../lib/api';

const SEVERITY_CONFIG = {
  critical: { icon: '🔴', label: 'Critical', bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
  warning: { icon: '🟡', label: 'Warning', bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
  info: { icon: '🔵', label: 'Info', bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' }
};

export default function DiscrepanciesReport({ month, year }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedChecks, setExpandedChecks] = useState({});

  useEffect(() => {
    setLoading(true);
    setError(null);
    api(`/api/reports/discrepancies?month=${month}&year=${year}`)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [month, year]);

  if (loading) return <div className="loading-spinner"><div className="spinner" />Running 12 automated checks...</div>;
  if (error) return <div className="error-banner"><strong>Error:</strong> {error}</div>;
  if (!data) return null;

  const { summary, checks } = data;

  const toggleExpand = (id) => {
    setExpandedChecks(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* Summary Bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <SummaryCard
          label="Checks Run"
          value={summary.total_checks}
          color="#03374f"
        />
        <SummaryCard
          label="Issues Found"
          value={summary.issues_found}
          color={summary.issues_found === 0 ? '#2e7d32' : '#c62828'}
        />
        <SummaryCard
          label="Critical"
          value={summary.critical}
          color={summary.critical > 0 ? '#c62828' : '#2e7d32'}
          icon="🔴"
        />
        <SummaryCard
          label="Warnings"
          value={summary.warnings}
          color={summary.warnings > 0 ? '#92400e' : '#2e7d32'}
          icon="🟡"
        />
        <SummaryCard
          label="Info"
          value={summary.info}
          color="#1e40af"
          icon="🔵"
        />
      </div>

      {/* Clean bill of health */}
      {summary.clean && (
        <div style={{
          background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px',
          padding: '24px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>✅</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#065f46' }}>All Clear</div>
          <div style={{ fontSize: '13px', color: '#047857', marginTop: '4px' }}>
            12 automated checks passed. No discrepancies found for {data.month}.
          </div>
        </div>
      )}

      {/* Issue Cards */}
      {checks.map(check => {
        const sev = SEVERITY_CONFIG[check.severity];
        const expanded = expandedChecks[check.id];

        return (
          <div
            key={check.id}
            style={{
              background: 'white',
              border: `1px solid ${sev.border}`,
              borderLeft: `4px solid ${sev.text}`,
              borderRadius: '8px',
              marginBottom: '12px',
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div
              onClick={() => toggleExpand(check.id)}
              style={{
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                background: sev.bg
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>{sev.icon}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#343a40' }}>
                    {check.title}
                  </div>
                  <div style={{ fontSize: '12px', color: '#495057', marginTop: '2px' }}>
                    {check.description}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{
                  background: sev.text, color: 'white', padding: '2px 10px',
                  borderRadius: '10px', fontSize: '12px', fontWeight: 700
                }}>
                  {check.count}
                </span>
                <span style={{ fontSize: '14px', color: '#868e96', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  ▼
                </span>
              </div>
            </div>

            {/* Expanded Details */}
            {expanded && check.details && check.details.length > 0 && (
              <div style={{ borderTop: `1px solid ${sev.border}` }}>
                <div className="report-table-wrapper" style={{ borderRadius: 0, border: 'none' }}>
                  <table className="report-table">
                    <thead>
                      <tr>
                        {check.columns.map(col => (
                          <th key={col} className={isNumericColumn(col) ? '' : 'text-left'}>
                            {formatColumnName(col)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {check.details.map((row, i) => (
                        <tr key={i}>
                          {check.columns.map(col => (
                            <td key={col} className={isNumericColumn(col) ? '' : 'text-left'}>
                              {formatCellValue(col, row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {check.details.length >= 20 && (
                  <div style={{ padding: '8px 16px', fontSize: '11px', color: '#868e96', background: '#f8f9fa' }}>
                    Showing first 20 of {check.count} records. Use Ask Tessa for the full list.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Methodology */}
      <div style={{
        marginTop: '24px', padding: '16px', background: '#f8f9fa',
        border: '1px solid #e9ecef', borderRadius: '8px'
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#adb5bd', marginBottom: '10px' }}>
          How These Checks Work
        </div>
        <div style={{ fontSize: '12px', color: '#495057', lineHeight: 1.6 }}>
          <p style={{ marginBottom: '6px' }}><strong>12 automated checks</strong> run against your data every time you load this tab:</p>
          <p style={{ marginBottom: '4px' }}>🔴 <strong>Critical:</strong> Issues that affect report accuracy — zero revenue orders, missing branches, duplicate records, revenue drops, missing escrow fees</p>
          <p style={{ marginBottom: '4px' }}>🟡 <strong>Warning:</strong> Items that need attention — missing personnel, low closing ratios, reps dropping to zero, high-value orders, orders with no open record</p>
          <p style={{ marginBottom: '4px' }}>🔵 <strong>Info:</strong> Observations — closing ratios above 100% (backlog clearing)</p>
          <p style={{ marginTop: '8px', color: '#868e96' }}>Data is compared against the selected month and its prior month. Click any check to see the specific records. Ask Tessa for deeper analysis.</p>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color, icon }) {
  return (
    <div style={{
      flex: 1, background: 'white', border: '1px solid #e9ecef', borderRadius: '8px',
      padding: '12px 14px', textAlign: 'center'
    }}>
      <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#adb5bd', marginBottom: '4px' }}>
        {icon && <span style={{ marginRight: '4px' }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function formatColumnName(col) {
  return col
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Pct', '%')
    .replace('Cnt', 'Count')
    .replace('Rev', 'Revenue');
}

function isNumericColumn(col) {
  return col.includes('rev') || col.includes('revenue') || col.includes('cnt') ||
    col.includes('ratio') || col.includes('change') || col.includes('amount') ||
    col.includes('occurrences') || col.includes('total') || col.includes('opens') ||
    col.includes('orders') || col.includes('open_cnt') || col.includes('close_cnt');
}

function formatCellValue(col, val) {
  if (val === null || val === undefined) return '';
  if (col.includes('rev') || col.includes('revenue') || col.includes('amount') || col === 'total_rev' || col === 'current_rev' || col === 'prior_rev') {
    return formatCurrency(parseFloat(val));
  }
  if (col.includes('change') || col === 'ratio') {
    return `${val}%`;
  }
  if (typeof val === 'number') return val.toLocaleString();
  return val;
}
