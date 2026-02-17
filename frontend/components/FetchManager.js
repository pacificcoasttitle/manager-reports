'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function FetchManager() {
  const [months, setMonths] = useState([]);
  const [fetchLog, setFetchLog] = useState([]);
  const [yearMonth, setYearMonth] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    loadData();
    const now = new Date();
    setYearMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }, []);

  async function loadData() {
    try {
      const [m, l] = await Promise.all([api('/api/months'), api('/api/fetch-log')]);
      setMonths(m);
      setFetchLog(l);
    } catch (err) { console.error(err); }
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

  return (
    <div style={{ maxWidth: '800px' }}>
      {/* Fetch controls */}
      <div className="fetch-card">
        <h3>Fetch Month from SoftPro</h3>
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

      {/* Available months */}
      <div className="fetch-card">
        <h3>Available Months</h3>
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
