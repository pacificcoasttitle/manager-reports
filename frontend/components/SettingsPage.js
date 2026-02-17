'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const REPORT_OPTIONS = [
  { id: 'daily-revenue', label: 'Daily Revenue' },
  { id: 'r14-branches', label: 'R-14 Branches' },
  { id: 'r14-ranking', label: 'R-14 Ranking' },
  { id: 'title-officer', label: 'Title Officer' },
  { id: 'escrow', label: 'Escrow Production' },
];

export default function SettingsPage({ showKPI, onToggleKPI }) {
  const [emailConfig, setEmailConfig] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // New recipient form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newReports, setNewReports] = useState(['daily-revenue', 'r14-ranking']);

  // SendGrid form
  const [apiKey, setApiKey] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [scheduleTime, setScheduleTime] = useState('07:00');
  const [emailActive, setEmailActive] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const data = await api('/api/settings/email');
      setEmailConfig(data.config);
      setRecipients(data.recipients || []);
      if (data.config) {
        setApiKey(data.config.sendgrid_api_key || '');
        setFromEmail(data.config.from_email || '');
        setFromName(data.config.from_name || '');
        setScheduleTime(data.config.schedule_time || '07:00');
        setEmailActive(data.config.is_active || false);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function saveEmailConfig() {
    setSaving(true);
    try {
      await api('/api/settings/email', {
        method: 'PUT',
        body: JSON.stringify({
          sendgrid_api_key: apiKey,
          from_email: fromEmail,
          from_name: fromName,
          schedule_time: scheduleTime,
          is_active: emailActive
        })
      });
      loadSettings();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  async function addRecipient() {
    if (!newName || !newEmail) return;
    try {
      await api('/api/settings/recipients', {
        method: 'POST',
        body: JSON.stringify({ name: newName, email: newEmail, reports: newReports })
      });
      setNewName(''); setNewEmail(''); setNewReports(['daily-revenue', 'r14-ranking']);
      loadSettings();
    } catch (e) { console.error(e); }
  }

  async function toggleRecipient(id, currentActive) {
    try {
      await api(`/api/settings/recipients/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !currentActive })
      });
      loadSettings();
    } catch (e) { console.error(e); }
  }

  async function deleteRecipient(id) {
    try {
      await api(`/api/settings/recipients/${id}`, { method: 'DELETE' });
      loadSettings();
    } catch (e) { console.error(e); }
  }

  async function sendTestEmail() {
    setTestResult(null);
    try {
      const result = await api('/api/settings/test-email', {
        method: 'POST',
        body: JSON.stringify({ reportId: 'r14-ranking', month: new Date().getMonth() + 1, year: new Date().getFullYear() })
      });
      setTestResult({ success: true, results: result.results });
    } catch (e) {
      setTestResult({ success: false, error: e.message });
    }
  }

  if (loading) return <div className="loading-spinner"><div className="spinner" />Loading settings...</div>;

  const inputStyle = {
    padding: '8px 12px', border: '1px solid #dee2e6', borderRadius: '6px',
    fontSize: '13px', outline: 'none', width: '100%'
  };

  return (
    <div style={{ maxWidth: '700px' }}>
      {/* Display Settings */}
      <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#343a40', marginBottom: '16px' }}>Display Settings</h3>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
          <div>
            <div style={{ fontSize: '13px', color: '#495057' }}>Show KPI Cards</div>
            <div style={{ fontSize: '11px', color: '#adb5bd', marginTop: '2px' }}>Display summary cards above reports</div>
          </div>
          <div
            className={`toggle ${showKPI ? 'on' : ''}`}
            onClick={onToggleKPI}
          >
            <div className="toggle-knob" />
          </div>
        </div>
      </div>

      {/* SendGrid Configuration */}
      <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#343a40', marginBottom: '16px' }}>Email Configuration (SendGrid)</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#868e96', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>SendGrid API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="SG.xxxxxxxxxx"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#868e96', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>From Email</label>
              <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="reports@pacificcoasttitle.com" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#868e96', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>From Name</label>
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="PCT Reports" style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#868e96', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Daily Schedule (PST)</label>
              <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '2px' }}>
              <div className={`toggle ${emailActive ? 'on' : ''}`} onClick={() => setEmailActive(!emailActive)}>
                <div className="toggle-knob" />
              </div>
              <span style={{ fontSize: '13px', color: '#495057' }}>{emailActive ? 'Active' : 'Inactive'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button onClick={saveEmailConfig} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button onClick={sendTestEmail} className="btn-accent">
              Send Test Email
            </button>
          </div>

          {testResult && (
            <div style={{
              padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginTop: '4px',
              background: testResult.success ? '#ecfdf5' : '#fef2f2',
              color: testResult.success ? '#065f46' : '#991b1b'
            }}>
              {testResult.success
                ? <>Test emails sent: {testResult.results?.map(r => `${r.email} (${r.status})`).join(', ')}</>
                : <>Error: {testResult.error}</>
              }
            </div>
          )}
        </div>
      </div>

      {/* Email Recipients */}
      <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#343a40', marginBottom: '16px' }}>Email Recipients</h3>

        {/* Existing recipients */}
        {recipients.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            {recipients.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f3f5' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#343a40' }}>{r.name}</div>
                  <div style={{ fontSize: '12px', color: '#868e96' }}>{r.email}</div>
                  <div style={{ fontSize: '11px', color: '#adb5bd', marginTop: '2px' }}>
                    Reports: {(r.reports || []).join(', ')}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className={`toggle ${r.is_active ? 'on' : ''}`} onClick={() => toggleRecipient(r.id, r.is_active)}>
                    <div className="toggle-knob" />
                  </div>
                  <button
                    onClick={() => deleteRecipient(r.id)}
                    style={{ fontSize: '11px', color: '#c62828', cursor: 'pointer', background: 'none', border: 'none' }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add new recipient */}
        <div style={{ borderTop: recipients.length > 0 ? '1px solid #e9ecef' : 'none', paddingTop: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#868e96', marginBottom: '10px', textTransform: 'uppercase' }}>Add Recipient</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" style={inputStyle} />
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" style={inputStyle} />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '11px', color: '#868e96', marginBottom: '6px' }}>Reports to receive:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {REPORT_OPTIONS.map(opt => {
                const active = newReports.includes(opt.id);
                return (
                  <div
                    key={opt.id}
                    onClick={() => {
                      setNewReports(prev =>
                        active ? prev.filter(r => r !== opt.id) : [...prev, opt.id]
                      );
                    }}
                    style={{
                      padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer',
                      border: `1px solid ${active ? '#f26b2b' : '#dee2e6'}`,
                      background: active ? 'rgba(242,107,43,0.08)' : 'white',
                      color: active ? '#f26b2b' : '#868e96',
                      fontWeight: active ? 600 : 400
                    }}
                  >
                    {opt.label}
                  </div>
                );
              })}
            </div>
          </div>
          <button onClick={addRecipient} className="btn-primary" disabled={!newName || !newEmail}>
            Add Recipient
          </button>
        </div>
      </div>
    </div>
  );
}
