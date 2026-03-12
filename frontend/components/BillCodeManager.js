'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, formatCurrency } from '../lib/api';

const CLASSIFICATIONS = [
  { value: 'revenue',      label: 'Revenue',      color: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'fee_income',   label: 'Fee Income',   color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'pass_through', label: 'Pass-Through', color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb' },
  { value: 'excluded',     label: 'Excluded',     color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
  { value: 'unclassified', label: 'Unclassified', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
];

const BUCKETS = [
  { value: 'title',       label: 'Title' },
  { value: 'escrow',      label: 'Escrow' },
  { value: 'tsg',         label: 'TSG' },
  { value: 'underwriter', label: 'Underwriter' },
  { value: 'fee',         label: 'Fee' },
];

function getClassStyle(classification) {
  return CLASSIFICATIONS.find(c => c.value === classification) || CLASSIFICATIONS[4];
}

export default function BillCodeManager() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const fetchCodes = useCallback(async () => {
    try {
      const data = await api('/api/admin/bill-codes');
      setCodes(data);
    } catch (err) {
      console.error('Failed to load bill codes:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleClassificationChange = async (billCode, classification) => {
    const needsBucket = ['revenue', 'fee_income'].includes(classification);
    const code = codes.find(c => c.bill_code === billCode);
    const bucket = needsBucket ? (code?.revenue_bucket || 'fee') : null;

    try {
      const updated = await api(`/api/admin/bill-codes/${billCode}`, {
        method: 'PUT',
        body: JSON.stringify({ classification, revenue_bucket: bucket }),
      });
      setCodes(prev => prev.map(c => c.bill_code === billCode ? { ...c, ...updated } : c));
      showToast(`${billCode} → ${CLASSIFICATIONS.find(c => c.value === classification)?.label}`);
      if (needsBucket && !code?.revenue_bucket) {
        showToast('Revenue reports will update on next data import', 'info');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleBucketChange = async (billCode, revenue_bucket) => {
    const code = codes.find(c => c.bill_code === billCode);
    try {
      const updated = await api(`/api/admin/bill-codes/${billCode}`, {
        method: 'PUT',
        body: JSON.stringify({ classification: code.classification, revenue_bucket }),
      });
      setCodes(prev => prev.map(c => c.bill_code === billCode ? { ...c, ...updated } : c));
      showToast(`${billCode} bucket → ${BUCKETS.find(b => b.value === revenue_bucket)?.label}`);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const grouped = {};
  CLASSIFICATIONS.forEach(c => { grouped[c.value] = []; });
  codes.forEach(c => {
    if (grouped[c.classification]) grouped[c.classification].push(c);
    else grouped['unclassified'].push(c);
  });

  const summaryCards = CLASSIFICATIONS.map(cls => {
    const items = grouped[cls.value] || [];
    const total = items.reduce((s, c) => s + parseFloat(c.avg_monthly_amount || 0), 0);
    return { ...cls, count: items.length, total };
  });

  const unclassifiedCount = grouped['unclassified'].length;
  const unclassifiedTotal = grouped['unclassified'].reduce((s, c) => s + parseFloat(c.avg_monthly_amount || 0), 0);

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: '#868e96' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        Loading bill codes...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 1000,
          padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          background: toast.type === 'error' ? '#ef4444' : toast.type === 'info' ? '#3b82f6' : '#22c55e'
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#03374f' }}>
          Bill Code Classifications
        </h3>
        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#868e96' }}>
          Determine which SoftPro bill codes count as PCT revenue
        </p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {summaryCards.map(card => (
          <div key={card.value} style={{
            padding: '14px 16px', borderRadius: '8px', border: `1px solid ${card.border}`,
            background: card.bg, borderLeft: `4px solid ${card.color}`
          }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: card.color, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
              {card.label}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', marginTop: '4px' }}>
              {card.count}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>
              {card.total > 0 ? `${formatCurrency(card.total)}/mo` : '$0/mo'}
            </div>
          </div>
        ))}
      </div>

      {/* Unclassified Warning */}
      {unclassifiedCount > 0 && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', marginBottom: '16px',
          background: '#fffbeb', border: '1px solid #fde68a', fontSize: '13px', color: '#92400e'
        }}>
          <strong>&#9888; {unclassifiedCount} bill code{unclassifiedCount > 1 ? 's' : ''}</strong>
          {unclassifiedTotal > 0 ? ` worth ~${formatCurrency(unclassifiedTotal)}/month` : ''} {unclassifiedCount > 1 ? 'are' : 'is'} unclassified.
          Revenue reports may be incomplete until these are classified.
        </div>
      )}

      {/* Grouped Sections */}
      {CLASSIFICATIONS.map(cls => {
        const items = grouped[cls.value];
        if (items.length === 0) return null;
        const sectionTotal = items.reduce((s, c) => s + parseFloat(c.avg_monthly_amount || 0), 0);
        return (
          <div key={cls.value} style={{ marginBottom: '20px' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '8px', padding: '0 2px'
            }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: cls.color }}>
                {cls.value === 'unclassified' && '⚠ '}{cls.label}
                <span style={{ fontWeight: 400, color: '#868e96', marginLeft: '6px' }}>
                  ({items.length} code{items.length !== 1 ? 's' : ''})
                </span>
              </div>
              {sectionTotal > 0 && (
                <span style={{ fontSize: '12px', color: '#495057', fontWeight: 600 }}>
                  {formatCurrency(sectionTotal)}/mo
                </span>
              )}
            </div>

            <div style={{ border: `1px solid ${cls.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              {items.map((code, i) => (
                <BillCodeRow
                  key={code.bill_code}
                  code={code}
                  cls={cls}
                  isLast={i === items.length - 1}
                  onClassificationChange={handleClassificationChange}
                  onBucketChange={handleBucketChange}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Info Note */}
      <div style={{
        padding: '12px 16px', borderRadius: '8px', background: '#f0f9ff',
        border: '1px solid #bae6fd', fontSize: '12px', color: '#0369a1', marginTop: '8px'
      }}>
        <strong>Note:</strong> Changes here won&apos;t affect existing revenue data until the next data import.
        The import pipeline integration is disabled until classifications are finalized.
      </div>
    </div>
  );
}

function BillCodeRow({ code, cls, isLast, onClassificationChange, onBucketChange }) {
  const showBucket = ['revenue', 'fee_income'].includes(code.classification);
  const amt = parseFloat(code.avg_monthly_amount || 0);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
      background: cls.bg, borderBottom: isLast ? 'none' : `1px solid ${cls.border}`,
      borderLeft: `3px solid ${cls.color}`, flexWrap: 'wrap'
    }}>
      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '13px', color: '#1a1a1a', minWidth: '48px' }}>
        {code.bill_code}
      </span>
      <span style={{ fontSize: '12px', color: '#495057', flex: '1 1 160px', minWidth: '120px' }}>
        {code.bill_code_category || '—'}
      </span>
      <span style={{ fontSize: '12px', color: '#6b7280', minWidth: '70px', textAlign: 'right', fontWeight: 500 }}>
        {amt > 0 ? `${formatCurrency(amt)}/mo` : '—'}
      </span>
      <select
        value={code.classification}
        onChange={e => onClassificationChange(code.bill_code, e.target.value)}
        style={{
          padding: '4px 8px', fontSize: '11px', borderRadius: '6px', border: '1px solid #dee2e6',
          background: '#fff', cursor: 'pointer', fontWeight: 600, minWidth: '110px'
        }}
      >
        {CLASSIFICATIONS.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      {showBucket && (
        <select
          value={code.revenue_bucket || ''}
          onChange={e => onBucketChange(code.bill_code, e.target.value)}
          style={{
            padding: '4px 8px', fontSize: '11px', borderRadius: '6px', border: '1px solid #bfdbfe',
            background: '#eff6ff', cursor: 'pointer', fontWeight: 600, minWidth: '100px'
          }}
        >
          <option value="">Bucket...</option>
          {BUCKETS.map(b => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
