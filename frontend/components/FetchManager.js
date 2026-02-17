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
    // Default to current month
    const now = new Date();
    setYearMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }, []);

  async function loadData() {
    try {
      const [m, l] = await Promise.all([
        api('/api/months'),
        api('/api/fetch-log'),
      ]);
      setMonths(m);
      setFetchLog(l);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
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
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Fetch controls */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-lg mb-3">Fetch Month from SoftPro</h3>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => {
              const val = e.target.value; // "2026-02"
              setYearMonth(val);
            }}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          />
          <button
            onClick={handleFetch}
            disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Fetching...' : 'Fetch Data'}
          </button>
          {loading && (
            <span className="text-sm text-gray-500">This may take several minutes...</span>
          )}
        </div>

        {result && (
          <div className={`mt-3 p-3 rounded text-sm ${result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {result.success ? (
              <div>
                <strong>Success!</strong> Fetched {result.records_fetched} records →{' '}
                {result.unique_orders} orders → ${result.total_revenue?.toFixed(2)} revenue
                ({(result.duration_ms / 1000).toFixed(1)}s)
              </div>
            ) : (
              <div><strong>Error:</strong> {result.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Available months */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-lg mb-3">Available Months</h3>
        {months.length === 0 ? (
          <p className="text-gray-500 text-sm">No data fetched yet.</p>
        ) : (
          <table className="report-table">
            <thead>
              <tr>
                <th className="text-left">Month</th>
                <th>Orders</th>
                <th>Total Revenue</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.fetch_month}>
                  <td className="text-left">{m.fetch_month}</td>
                  <td>{m.order_count}</td>
                  <td>${parseFloat(m.total_revenue).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Fetch log */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-lg mb-3">Fetch History</h3>
        <table className="report-table">
          <thead>
            <tr>
              <th className="text-left">Month</th>
              <th>Records</th>
              <th>Orders</th>
              <th>Revenue</th>
              <th className="text-left">Status</th>
              <th>Duration</th>
              <th className="text-left">Fetched At</th>
            </tr>
          </thead>
          <tbody>
            {fetchLog.map((log) => (
              <tr key={log.id}>
                <td className="text-left">{log.fetch_month}</td>
                <td>{log.records_fetched}</td>
                <td>{log.unique_orders}</td>
                <td>{log.total_revenue ? `$${parseFloat(log.total_revenue).toLocaleString()}` : ''}</td>
                <td className="text-left">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    log.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {log.status}
                  </span>
                </td>
                <td>{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : ''}</td>
                <td className="text-left text-xs">{new Date(log.fetched_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
