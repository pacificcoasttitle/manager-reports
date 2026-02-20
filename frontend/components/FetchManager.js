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

  // Import log + cron state
  const [importLog, setImportLog] = useState([]);
  const [cronEnabled, setCronEnabled] = useState(true);
  const [cronTime, setCronTime] = useState('21:00');
  const [cronSaving, setCronSaving] = useState(false);


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
    // Load import log
    try {
      const log = await api('/api/import/log');
      setImportLog(log);
    } catch (err) { console.error('Import log:', err); }
    // Load cron + email settings
    try {
      const settings = await api('/api/settings/app');
      if (settings.cron_enabled !== undefined) setCronEnabled(settings.cron_enabled === 'true');
      if (settings.cron_time) setCronTime(settings.cron_time);
    } catch (err) { console.error('Settings:', err); }
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


  async function saveCronSettings(enabled, time) {
    setCronSaving(true);
    try {
      await api('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'cron_enabled', value: String(enabled) })
      });
      await api('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'cron_time', value: time })
      });
      setCronEnabled(enabled);
      setCronTime(time);
    } catch (err) {
      console.error('Failed to save cron settings:', err);
    } finally { setCronSaving(false); }
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

      {/* Automated Import Schedule */}
      <div className="fetch-card">
        <h3>Automated Import Schedule</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={cronEnabled}
              onChange={(e) => saveCronSettings(e.target.checked, cronTime)}
              style={{ width: '16px', height: '16px' }}
            />
            Nightly auto-import
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
            Time (Pacific):
            <input
              type="time"
              value={cronTime}
              onChange={(e) => setCronTime(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid #dee2e6', borderRadius: '6px', fontSize: '13px' }}
            />
            <button
              onClick={() => saveCronSettings(cronEnabled, cronTime)}
              disabled={cronSaving}
              className="btn-accent"
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              {cronSaving ? 'Saving...' : 'Save'}
            </button>
          </label>
        </div>
        <p style={{ fontSize: '11px', color: '#868e96', marginTop: '8px' }}>
          {cronEnabled
            ? `Auto-imports revenue + open orders for the current month every day at ${cronTime} Pacific.`
            : 'Automated imports are disabled. Use the buttons above for manual imports.'}
        </p>
      </div>

      {/* Import History (unified log) */}
      <div className="fetch-card">
        <h3>Import History</h3>
        {(() => {
          const lastAuto = importLog.find(l => l.triggered_by === 'cron' && l.success);
          return lastAuto ? (
            <p style={{ fontSize: '12px', color: '#495057', marginBottom: '10px' }}>
              Last automated import: {new Date(lastAuto.started_at).toLocaleString()} ({lastAuto.import_type}, {lastAuto.month})
            </p>
          ) : null;
        })()}
        {importLog.length === 0 ? (
          <p style={{ color: '#868e96', fontSize: '13px' }}>No imports logged yet.</p>
        ) : (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th className="text-left">Time</th>
                  <th className="text-left">Type</th>
                  <th>Month</th>
                  <th>Records</th>
                  <th className="text-left">Status</th>
                  <th>Duration</th>
                  <th className="text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {importLog.map(log => (
                  <tr key={log.id}>
                    <td className="text-left" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                      {new Date(log.started_at).toLocaleString()}
                    </td>
                    <td className="text-left">
                      <span style={{
                        padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                        background: log.import_type === 'revenue' ? '#e8f5e9' : '#e3f2fd',
                        color: log.import_type === 'revenue' ? '#2e7d32' : '#1565c0'
                      }}>
                        {log.import_type === 'revenue' ? 'Revenue' : 'Open Orders'}
                      </span>
                    </td>
                    <td>{log.month}</td>
                    <td>{log.records_imported || 0}</td>
                    <td className="text-left">
                      {log.success ? (
                        <span style={{ color: '#2e7d32', fontWeight: 600, fontSize: '12px' }}>✓ Success</span>
                      ) : (
                        <span title={log.error_message || ''} style={{ color: '#c62828', fontWeight: 600, fontSize: '12px', cursor: 'help' }}>✗ Failed</span>
                      )}
                    </td>
                    <td>{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : ''}</td>
                    <td className="text-left">
                      <span style={{
                        padding: '2px 6px', borderRadius: '8px', fontSize: '10px',
                        background: log.triggered_by === 'cron' ? '#fff3e0' : '#f3e5f5',
                        color: log.triggered_by === 'cron' ? '#e65100' : '#7b1fa2'
                      }}>
                        {log.triggered_by === 'cron' ? '⏰ Auto' : '👤 Manual'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Data Summary Tables */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {/* Revenue Data */}
        <div className="fetch-card" style={{ flex: 1, minWidth: '300px' }}>
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

        {/* Open Orders Data */}
        <div className="fetch-card" style={{ flex: 1, minWidth: '300px' }}>
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
      </div>
    </div>
  );
}
