'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, formatCurrency } from '../lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://manager-reports.onrender.com';

const BRANCH_BADGE = {
  'Glendale':      { bg: '#dbeafe', color: '#1e40af' },
  'Orange':        { bg: '#fed7aa', color: '#9a3412' },
  'Inland Empire': { bg: '#e9d5ff', color: '#6b21a8' },
  'Porterville':   { bg: '#d1fae5', color: '#065f46' },
  'TSG':           { bg: '#f3f4f6', color: '#374151' },
  'Unassigned':    { bg: '#f3f4f6', color: '#6b7280' },
};

const COLUMNS = [
  { key: 'file_number',        label: 'File Number',   sortable: true,  align: 'left' },
  { key: 'branch',             label: 'Branch',        sortable: true,  align: 'left' },
  { key: 'category',           label: 'Category',      sortable: true,  align: 'left' },
  { key: 'sales_rep',          label: 'Sales Rep',     sortable: true,  align: 'left' },
  { key: 'title_officer',      label: 'Title Officer', sortable: true,  align: 'left' },
  { key: 'transaction_date',   label: 'Date',          sortable: true,  align: 'center' },
  { key: 'title_revenue',      label: 'Title Rev',     sortable: true,  align: 'right' },
  { key: 'escrow_revenue',     label: 'Escrow Rev',    sortable: true,  align: 'right' },
  { key: 'underwriter_revenue',label: 'UW Rev',        sortable: true,  align: 'right' },
  { key: 'total_revenue',      label: 'Total Rev',     sortable: true,  align: 'right' },
];

const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

export default function DataExplorer({ month, year }) {
  const [data, setData] = useState({ rows: [], total: 0, summary: {}, filters: {} });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ col: 'transaction_date', dir: 'desc' });
  const [filterBranch, setFilterBranch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSalesRep, setFilterSalesRep] = useState('');
  const [filterTitleOfficer, setFilterTitleOfficer] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const limit = 50;

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month: yearMonth, page: String(page), limit: String(limit), sort: sort.col, dir: sort.dir });
      if (filterBranch) params.set('branch', filterBranch);
      if (filterCategory) params.set('category', filterCategory);
      if (filterSalesRep) params.set('salesRep', filterSalesRep);
      if (filterTitleOfficer) params.set('titleOfficer', filterTitleOfficer);
      if (search) params.set('search', search);
      const result = await api(`/api/data/orders?${params}`);
      setData(result);
    } catch (err) {
      console.error('DataExplorer fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [yearMonth, page, sort, filterBranch, filterCategory, filterSalesRep, filterTitleOfficer, search]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [yearMonth, filterBranch, filterCategory, filterSalesRep, filterTitleOfficer, search]);

  const handleSort = (col) => {
    setSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilterBranch(''); setFilterCategory(''); setFilterSalesRep(''); setFilterTitleOfficer(''); setSearchInput(''); setSearch('');
  };

  const hasFilters = filterBranch || filterCategory || filterSalesRep || filterTitleOfficer || search;

  const handleExport = () => {
    const params = new URLSearchParams({ month: yearMonth });
    if (filterBranch) params.set('branch', filterBranch);
    if (filterCategory) params.set('category', filterCategory);
    if (filterSalesRep) params.set('salesRep', filterSalesRep);
    if (filterTitleOfficer) params.set('titleOfficer', filterTitleOfficer);
    if (search) params.set('search', search);
    window.open(`${API_BASE}/api/data/orders/export?${params}`, '_blank');
  };

  const totalPages = Math.ceil(data.total / limit);
  const { branches = [], categories = [], salesReps = [], titleOfficers = [] } = data.filters || {};
  const summary = data.summary || {};

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#03374f' }}>
            Live Data — {monthNames[month]} {year}
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#868e96' }}>
            Browse, filter, and drill into the raw order dataset
          </p>
        </div>
        <button onClick={handleExport} style={{
          padding: '7px 16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          background: '#fff', border: '1px solid #dee2e6', borderRadius: '6px', color: '#495057',
          display: 'flex', alignItems: 'center', gap: '6px'
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export CSV
        </button>
      </div>

      {/* Filter Bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center',
        padding: '12px 16px', background: '#f8f9fa', borderRadius: '8px',
        border: '1px solid #e9ecef', marginBottom: '12px'
      }}>
        <FilterSelect label="Branch" value={filterBranch} options={branches} onChange={setFilterBranch} />
        <FilterSelect label="Category" value={filterCategory} options={categories} onChange={setFilterCategory} />
        <FilterSelect label="Sales Rep" value={filterSalesRep} options={salesReps} onChange={setFilterSalesRep} />
        <FilterSelect label="Title Officer" value={filterTitleOfficer} options={titleOfficers} onChange={setFilterTitleOfficer} />
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: '160px' }}>
          <input
            type="text"
            placeholder="Search file number..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px 6px 28px', border: '1px solid #dee2e6',
              borderRadius: '6px', fontSize: '12px', background: '#fff', boxSizing: 'border-box'
            }}
          />
          <span style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', color: '#adb5bd', lineHeight: 1 }}>&#128269;</span>
        </div>
        {hasFilters && (
          <button onClick={clearFilters} style={{
            padding: '5px 12px', fontSize: '11px', background: '#fff', border: '1px solid #dee2e6',
            borderRadius: '6px', cursor: 'pointer', color: '#868e96', fontWeight: 600
          }}>
            Clear All
          </button>
        )}
      </div>

      {/* Summary Bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 4px', fontSize: '12px', color: '#495057', marginBottom: '2px'
      }}>
        <span>
          Showing <strong>{data.rows.length > 0 ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, data.total)}</strong> of <strong>{data.total.toLocaleString()}</strong> orders
        </span>
        <span>
          Filtered total: <strong>{data.total.toLocaleString()}</strong> orders &middot; <strong style={{ color: '#03374f', fontSize: '13px' }}>{formatCurrency(summary.total_revenue)}</strong>
        </span>
      </div>

      {/* Table */}
      <div style={{
        border: '1px solid #e9ecef', borderRadius: '8px', overflow: 'hidden',
        background: '#fff', position: 'relative'
      }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2
          }}>
            <div className="spinner" />
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f8f9fa' }}>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && handleSort(col.key)}
                    style={{
                      textAlign: col.align, padding: '10px 12px', fontWeight: 600, color: '#495057',
                      borderBottom: '2px solid #dee2e6', cursor: col.sortable ? 'pointer' : 'default',
                      userSelect: 'none', whiteSpace: 'nowrap', fontSize: '11px',
                      textTransform: 'uppercase', letterSpacing: '0.3px'
                    }}
                  >
                    {col.label}
                    {sort.col === col.key && <span style={{ marginLeft: '3px', fontSize: '9px' }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && !loading && (
                <tr><td colSpan={COLUMNS.length} style={{ textAlign: 'center', padding: '48px 0', color: '#868e96' }}>No orders found for the selected filters.</td></tr>
              )}
              {data.rows.map((row, i) => (
                <OrderRow
                  key={row.file_number}
                  row={row}
                  index={i}
                  expanded={expandedRow === row.file_number}
                  onToggle={() => setExpandedRow(expandedRow === row.file_number ? null : row.file_number)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px',
          marginTop: '16px', fontSize: '12px'
        }}>
          <PageBtn label="«" disabled={page <= 1} onClick={() => setPage(1)} />
          <PageBtn label="‹" disabled={page <= 1} onClick={() => setPage(p => p - 1)} />
          {pageRange(page, totalPages).map((p, i) =>
            p === '...' ? <span key={`e${i}`} style={{ padding: '0 6px', color: '#adb5bd' }}>...</span> :
            <PageBtn key={p} label={String(p)} active={p === page} onClick={() => setPage(p)} />
          )}
          <PageBtn label="›" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} />
          <PageBtn label="»" disabled={page >= totalPages} onClick={() => setPage(totalPages)} />
        </div>
      )}
    </div>
  );
}

function OrderRow({ row, index, expanded, onToggle }) {
  const badge = BRANCH_BADGE[row.branch] || BRANCH_BADGE['Unassigned'];
  const txDate = row.transaction_date
    ? new Date(row.transaction_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : '—';
  const rowBg = expanded ? '#fffbf5' : index % 2 === 1 ? '#fafbfc' : '#fff';

  return (
    <>
      <tr
        onClick={onToggle}
        style={{ background: rowBg, cursor: 'pointer', transition: 'background 0.1s' }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'rgba(3,55,79,0.02)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
      >
        <td style={{ ...td, textAlign: 'left', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#1d4ed8', fontWeight: 500, fontFamily: 'monospace', fontSize: '11.5px' }}>
            {expanded ? '▾' : '▸'} {row.file_number}
          </span>
        </td>
        <td style={{ ...td, textAlign: 'left' }}>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '10px',
            fontWeight: 600, color: badge.color, background: badge.bg
          }}>
            {row.branch}
          </span>
        </td>
        <td style={{ ...td, textAlign: 'left' }}>{row.category}</td>
        <td style={{ ...td, textAlign: 'left', whiteSpace: 'nowrap' }}>{row.sales_rep || '—'}</td>
        <td style={{ ...td, textAlign: 'left', whiteSpace: 'nowrap' }}>{row.title_officer || '—'}</td>
        <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>{txDate}</td>
        <td style={{ ...td, textAlign: 'right' }}>{fmtRev(row.title_revenue)}</td>
        <td style={{ ...td, textAlign: 'right' }}>{fmtRev(row.escrow_revenue)}</td>
        <td style={{ ...td, textAlign: 'right' }}>{fmtRev(row.underwriter_revenue)}</td>
        <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{formatCurrency(row.total_revenue)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLUMNS.length} style={{ padding: 0, background: '#fafbfc' }}>
            <RevenueDetail row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function RevenueDetail({ row }) {
  const lines = [
    { code: 'Title (TPC/TPW)',        amount: parseFloat(row.title_revenue) || 0 },
    { code: 'Escrow (ESC)',           amount: parseFloat(row.escrow_revenue) || 0 },
    { code: 'TSG (TSGW)',            amount: parseFloat(row.tsg_revenue) || 0 },
    { code: 'Underwriter (UPRE)',     amount: parseFloat(row.underwriter_revenue) || 0 },
  ];
  const total = parseFloat(row.total_revenue) || 0;

  return (
    <div style={{ padding: '12px 16px 14px 40px', borderLeft: '3px solid #f26b2b' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#495057', marginBottom: '6px' }}>
        Revenue Breakdown — {row.file_number}
        <span style={{ fontWeight: 400, color: '#868e96', marginLeft: '10px' }}>
          {row.order_type} &middot; {row.trans_type}
        </span>
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: '11px' }}>
        <tbody>
          {lines.filter(l => l.amount !== 0).map(l => (
            <tr key={l.code}>
              <td style={{ padding: '3px 20px 3px 0', color: '#6b7280' }}>{l.code}</td>
              <td style={{ padding: '3px 0', fontWeight: 600, color: '#374151', textAlign: 'right' }}>{formatCurrency(l.amount)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid #e5e7eb' }}>
            <td style={{ padding: '5px 20px 3px 0', fontWeight: 700, color: '#03374f' }}>Total</td>
            <td style={{ padding: '5px 0 3px', fontWeight: 700, color: '#03374f', textAlign: 'right' }}>{formatCurrency(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const td = { padding: '8px 12px', borderBottom: '1px solid #f1f3f5', fontSize: '12px', color: '#495057' };

function FilterSelect({ label, value, options, onChange }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: '6px',
        fontSize: '12px', background: value ? '#e8f5e9' : '#fff', color: '#495057',
        minWidth: '120px', cursor: 'pointer'
      }}
    >
      <option value="">All {label}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function PageBtn({ label, active, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px', fontSize: '12px', borderRadius: '4px',
        cursor: disabled ? 'default' : 'pointer',
        border: active ? '1px solid #03374f' : '1px solid #dee2e6',
        background: active ? '#03374f' : '#fff',
        color: active ? '#fff' : disabled ? '#ced4da' : '#495057',
        fontWeight: active ? 700 : 400
      }}
    >
      {label}
    </button>
  );
}

function fmtRev(val) {
  const n = parseFloat(val) || 0;
  return n === 0 ? '' : formatCurrency(n);
}

function pageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
