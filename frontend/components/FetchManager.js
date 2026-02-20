'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function FetchManager() {
  const [months, setMonths] = useState([]);
  const [fetchLog, setFetchLog] = useState([]);
  const [yearMonth, setYearMonth] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Open orders state
  const [openOrdersMonths, setOpenOrdersMonths] = useState([]);
  const [openMonth, setOpenMonth] = useState('');
  const [openLoading, setOpenLoading] = useState(false);
  const [openResult, setOpenResult] = useState(null);

  useEffect(() => {
    loadData();
    const now = new Date();
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setYearMonth(currentYM);
    setOpenMonth(currentYM);
  }, []);

  async function loadData() {
    try {
      const [m, l] = await Promise.all([api('/api/months'), api('/api/fetch-log')]);
      setMonths(m);
      setFetchLog(l);
    } catch (err) { console.error(err); }
    // Load open orders summary
    try {
      const openSummary = await api('/api/open-orders/summary');
      setOpenOrdersMonths(openSummary);
    } catch (err) { console.error('Open orders summary:', err); }
  }

  async function handleFetch() {
    if (!yearMonth || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await api(`/api/fetch/${yearMonth}`, { method: 'POST' });
      setResult({ success: true, ...res });
      loadData();
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally { setLoading(false); }
  }

  async function handleFetchOpenOrders(date) {
    if (openLoading) return;
    setOpenLoading(true);
    setOpenResult(null);
    try {
      const res = await api('/api/import/open-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date })
      });
      setOpenResult({ success: true, ...res });
      loadData();
    } catch (err) {
      setOpenResult({ success: false, error: err.message });
    } finally { setOpenLoading(false); }
  }

  async function handleFetchOpenOrdersToday() {
    if (openLoading) return;
    setOpenLoading(true);
    setOpenResult(null);
    try {
      const res = await api('/api/import/open-orders-today', { method: 'POST' });
      setOpenResult({ success: true, ...res });
      loadData();
    } catch (err) {
      setOpenResult({ success: false, error: err.message });
    } finally { setOpenLoading(false); }
  }

  return (
    <div style={{ maxWidth: '800px' }}>
      {/* Revenue Fetch controls */}
      <div className="fetch-card">
        <h3>Fetch Revenue from SoftPro</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: '6px', fontSize: '13px' }}
          />
          <button onClick={handleFetch} disabled={loading} className="btn-accent">
            {loading ? 'Fetching...' : 'Fetch Data'}
          </button>
          {loading && <span style={{ fontSize: '12px', color: '#868e96' }}>This may take several minutes...</span>}
        </div>
        {result && (
          <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', background: result.success ? '#ecfdf5' : '#fef2f2', color: result.success ? '#065f46' : '#991b1b' }}>
            {result.success
              ? <><strong>Success!</strong> {result.records_fetched} records → {result.unique_orders} orders → ${result.total_revenue?.toFixed(2)} ({(result.duration_ms / 1000).toFixed(1)}s)</>
              : <><strong>Error:</strong> {result.error}</>
            }
          </div>
        )}
      </div>

      {/* Open Orders Import */}
      <div className="fetch-card">
        <h3>Fetch Open Orders from SoftPro</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={handleFetchOpenOrdersToday} disabled={openLoading} className="btn-accent">
            {openLoading ? 'Fetching...' : 'Fetch Current Month'}
          </button>
          <span style={{ color: '#adb5bd', fontSize: '12px' }}>or</span>
          <input
            type="month"
            value={openMonth}
            onChange={(e) => setOpenMonth(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #dee2e6', borderRadius: '6px', fontSize: '13px' }}
          />
          <button
            onClick={() => handleFetchOpenOrders(`${openMonth}-01`)}
            disabled={openLoading || !openMonth}
            className="btn-accent"
            style={{ background: '#495057' }}
          >
            Fetch Month
          </button>
          {openLoading && <span style={{ fontSize: '12px', color: '#868e96' }}>This may take a minute...</span>}
        </div>
        {openResult && (
          <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', background: openResult.success ? '#ecfdf5' : '#fef2f2', color: openResult.success ? '#065f46' : '#991b1b' }}>
            {openResult.success
              ? <><strong>Success!</strong> {openResult.inserted} open orders imported for {openResult.month} (replaced {openResult.deleted} existing)</>
              : <><strong>Error:</strong> {openResult.error}</>
            }
          </div>
        )}
      </div>

      {/* Available months (Revenue) */}
      <div className="fetch-card">
        <h3>Revenue Data</h3>
        {months.length === 0 ? (
          <p style={{ color: '#868e96', fontSize: '13px' }}>No data fetched yet.</p>
        ) : (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr><th className="text-left">Month</th><th>Orders</th><th>Total Revenue</th></tr>
              </thead>
              <tbody>
                {months.map(m => (
                  <tr key={m.fetch_month}>
                    <td className="text-left">{m.fetch_month}</td>
                    <td>{m.order_count}</td>
                    <td>${parseFloat(m.total_revenue).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Open Orders Summary */}
      <div className="fetch-card">
        <h3>Open Orders Data</h3>
        {openOrdersMonths.length === 0 ? (
          <p style={{ color: '#868e96', fontSize: '13px' }}>No open orders imported yet.</p>
        ) : (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr><th className="text-left">Month</th><th>Orders</th><th>Branches</th></tr>
              </thead>
              <tbody>
                {openOrdersMonths.map(m => (
                  <tr key={m.open_month}>
                    <td className="text-left">{m.open_month}</td>
                    <td>{m.order_count}</td>
                    <td>{m.branch_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fetch log */}
      <div className="fetch-card">
        <h3>Fetch History</h3>
        <div className="report-table-wrapper">
          <table className="report-table">
            <thead>
              <tr>
                <th className="text-left">Month</th><th>Records</th><th>Orders</th><th>Revenue</th>
                <th className="text-left">Status</th><th>Duration</th><th className="text-left">Fetched At</th>
              </tr>
            </thead>
            <tbody>
              {fetchLog.map(log => (
                <tr key={log.id}>
                  <td className="text-left">{log.fetch_month}</td>
                  <td>{log.records_fetched}</td>
                  <td>{log.unique_orders}</td>
                  <td>{log.total_revenue ? `$${parseFloat(log.total_revenue).toLocaleString()}` : ''}</td>
                  <td className="text-left">
                    <span className={`status-badge ${log.status}`}>{log.status}</span>
                  </td>
                  <td>{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : ''}</td>
                  <td className="text-left" style={{ fontSize: '11px' }}>{new Date(log.fetched_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
