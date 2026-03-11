'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, formatCurrency } from '../lib/api';

const BRANCH_COLORS = {
  'Glendale': '#1d4ed8',
  'Orange': '#ea580c',
  'Inland Empire': '#7c3aed',
  'Porterville': '#0d9488',
  'TSG': '#be123c',
  'Unknown': '#6b7280',
  'Unassigned': '#6b7280'
};

const COLUMNS = [
  { key: 'file_number', label: 'File Number', sortable: true, align: 'left' },
  { key: 'branch', label: 'Branch', sortable: true, align: 'left' },
  { key: 'category', label: 'Category', sortable: true, align: 'left' },
  { key: 'sales_rep', label: 'Sales Rep', sortable: true, align: 'left' },
  { key: 'title_officer', label: 'Title Officer', sortable: true, align: 'left' },
  { key: 'transaction_date', label: 'Tx Date', sortable: true, align: 'center' },
  { key: 'title_revenue', label: 'Title', sortable: true, align: 'right' },
  { key: 'escrow_revenue', label: 'Escrow', sortable: true, align: 'right' },
  { key: 'tsg_revenue', label: 'TSG', sortable: true, align: 'right' },
  { key: 'underwriter_revenue', label: 'UW', sortable: true, align: 'right' },
  { key: 'total_revenue', label: 'Total Rev', sortable: true, align: 'right' },
];

export default function DataExplorer({ month, year }) {
  const [data, setData] = useState({ rows: [], total: 0, filteredRevenue: 0, filters: {} });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ col: 'transaction_date', dir: 'desc' });
  const [filters, setFilters] = useState({ branch: '', category: '', salesRep: '', titleOfficer: '', search: '' });
  const [expandedRow, setExpandedRow] = useState(null);
  const [lineItems, setLineItems] = useState({});
  const limit = 50;

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        month: yearMonth,
        page: String(page),
        limit: String(limit),
        sort: sort.col,
        dir: sort.dir
      });
      if (filters.branch) params.set('branch', filters.branch);
      if (filters.category) params.set('category', filters.category);
      if (filters.salesRep) params.set('salesRep', filters.salesRep);
      if (filters.titleOfficer) params.set('titleOfficer', filters.titleOfficer);
      if (filters.search) params.set('search', filters.search);

      const result = await api(`/api/data/orders?${params}`);
      setData(result);
    } catch (err) {
      console.error('DataExplorer fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [yearMonth, page, sort, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => { setPage(1); }, [yearMonth, filters]);

  const handleSort = (col) => {
    setSort(prev => ({
      col,
      dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc'
    }));
    setPage(1);
  };

  const handleFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleExpand = async (fileNumber) => {
    if (expandedRow === fileNumber) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(fileNumber);
    if (!lineItems[fileNumber]) {
      try {
        const detail = await api(`/api/orders/${encodeURIComponent(fileNumber)}`);
        setLineItems(prev => ({ ...prev, [fileNumber]: detail.lineItems }));
      } catch (err) {
        console.error('Detail fetch error:', err);
      }
    }
  };

  const totalPages = Math.ceil(data.total / limit);
  const { branches = [], categories = [], salesReps = [], titleOfficers = [] } = data.filters || {};

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Filter Bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center',
        padding: '14px 20px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '16px',
        border: '1px solid #e9ecef'
      }}>
        <FilterSelect label="Branch" value={filters.branch} options={branches} onChange={v => handleFilter('branch', v)} />
        <FilterSelect label="Category" value={filters.category} options={categories} onChange={v => handleFilter('category', v)} />
        <FilterSelect label="Sales Rep" value={filters.salesRep} options={salesReps} onChange={v => handleFilter('salesRep', v)} />
        <FilterSelect label="Title Officer" value={filters.titleOfficer} options={titleOfficers} onChange={v => handleFilter('titleOfficer', v)} />
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: '160px' }}>
          <input
            type="text"
            placeholder="Search file number..."
            value={filters.search}
            onChange={e => handleFilter('search', e.target.value)}
            style={{
              width: '100%', padding: '6px 10px 6px 30px', border: '1px solid #dee2e6',
              borderRadius: '6px', fontSize: '12px', background: '#fff'
            }}
          />
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#adb5bd' }}>&#128269;</span>
        </div>
        {(filters.branch || filters.category || filters.salesRep || filters.titleOfficer || filters.search) && (
          <button
            onClick={() => setFilters({ branch: '', category: '', salesRep: '', titleOfficer: '', search: '' })}
            style={{
              padding: '5px 12px', fontSize: '11px', background: '#fff', border: '1px solid #dee2e6',
              borderRadius: '6px', cursor: 'pointer', color: '#868e96', fontWeight: 600
            }}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Summary */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 4px', fontSize: '12px', color: '#495057', marginBottom: '4px'
      }}>
        <span>
          Showing {data.rows.length > 0 ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, data.total)} of <strong>{data.total}</strong> orders
        </span>
        <span>
          Filtered total: <strong style={{ color: '#03374f', fontSize: '13px' }}>{formatCurrency(data.filteredRevenue)}</strong>
        </span>
      </div>

      {/* Table */}
      <div className="report-table-wrapper" style={{ overflowX: 'auto', position: 'relative' }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2
          }}>
            <div className="spinner" />
          </div>
        )}
        <table className="report-table" style={{ fontSize: '12px' }}>
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  style={{
                    textAlign: col.align, cursor: col.sortable ? 'pointer' : 'default',
                    userSelect: 'none', whiteSpace: 'nowrap'
                  }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  {col.label}
                  {sort.col === col.key && (
                    <span style={{ marginLeft: '4px', fontSize: '10px' }}>
                      {sort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && !loading && (
              <tr><td colSpan={COLUMNS.length} style={{ textAlign: 'center', padding: '40px', color: '#868e96' }}>No orders found.</td></tr>
            )}
            {data.rows.map(row => (
              <OrderRow
                key={row.file_number}
                row={row}
                expanded={expandedRow === row.file_number}
                onToggle={() => toggleExpand(row.file_number)}
                lineItems={lineItems[row.file_number]}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px',
          marginTop: '16px', fontSize: '12px'
        }}>
          <PageBtn label="«" disabled={page <= 1} onClick={() => setPage(1)} />
          <PageBtn label="‹" disabled={page <= 1} onClick={() => setPage(p => p - 1)} />
          {pageRange(page, totalPages).map(p =>
            p === '...' ? <span key={`e${Math.random()}`} style={{ padding: '0 4px', color: '#adb5bd' }}>...</span> :
            <PageBtn key={p} label={String(p)} active={p === page} onClick={() => setPage(p)} />
          )}
          <PageBtn label="›" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} />
          <PageBtn label="»" disabled={page >= totalPages} onClick={() => setPage(totalPages)} />
        </div>
      )}
    </div>
  );
}

function OrderRow({ row, expanded, onToggle, lineItems }) {
  const branchColor = BRANCH_COLORS[row.branch] || '#6b7280';
  const txDate = row.transaction_date ? new Date(row.transaction_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td className="text-left" style={{ whiteSpace: 'nowrap' }}>
          <span style={{ color: '#1d4ed8', fontWeight: 500 }}>
            {expanded ? '▾' : '▸'} {row.file_number}
          </span>
        </td>
        <td className="text-left">
          <span style={{
            display: 'inline-block', padding: '1px 8px', borderRadius: '10px', fontSize: '10px',
            fontWeight: 600, color: '#fff', background: branchColor
          }}>
            {row.branch}
          </span>
        </td>
        <td className="text-left">{row.category}</td>
        <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{row.sales_rep || '—'}</td>
        <td className="text-left" style={{ whiteSpace: 'nowrap' }}>{row.title_officer || '—'}</td>
        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{txDate}</td>
        <td style={{ textAlign: 'right' }}>{fmtRev(row.title_revenue)}</td>
        <td style={{ textAlign: 'right' }}>{fmtRev(row.escrow_revenue)}</td>
        <td style={{ textAlign: 'right' }}>{fmtRev(row.tsg_revenue)}</td>
        <td style={{ textAlign: 'right' }}>{fmtRev(row.underwriter_revenue)}</td>
        <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(row.total_revenue)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLUMNS.length} style={{ padding: '0 0 0 28px', background: '#f8f9fa' }}>
            <LineItemDetail items={lineItems} fileNumber={row.file_number} />
          </td>
        </tr>
      )}
    </>
  );
}

function LineItemDetail({ items, fileNumber }) {
  if (!items) return <div style={{ padding: '12px', color: '#868e96', fontSize: '12px' }}>Loading line items...</div>;
  if (items.length === 0) return <div style={{ padding: '12px', color: '#868e96', fontSize: '12px' }}>No line items found for {fileNumber}.</div>;

  return (
    <div style={{ padding: '10px 0 14px' }}>
      <table style={{ width: 'auto', fontSize: '11px', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={liTh}>Bill Code</th>
            <th style={liTh}>Description</th>
            <th style={{ ...liTh, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td style={liTd}>
                <span style={{
                  display: 'inline-block', padding: '1px 6px', borderRadius: '4px', fontSize: '10px',
                  fontWeight: 600, background: '#e9ecef', color: '#495057'
                }}>
                  {item.bill_code}
                </span>
              </td>
              <td style={liTd}>{item.charge_description || item.bill_code_category || '—'}</td>
              <td style={{ ...liTd, textAlign: 'right', fontWeight: 600 }}>{formatCurrency(item.sum_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const liTh = { padding: '4px 12px 4px 0', fontWeight: 600, color: '#495057', borderBottom: '1px solid #dee2e6', textAlign: 'left' };
const liTd = { padding: '4px 12px 4px 0', color: '#495057', borderBottom: '1px solid #f1f3f5' };

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
        padding: '4px 10px', fontSize: '12px', borderRadius: '4px', cursor: disabled ? 'default' : 'pointer',
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
  if (n === 0) return '';
  return formatCurrency(n);
}

function pageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
