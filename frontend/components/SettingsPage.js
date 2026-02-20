'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://manager-reports.onrender.com';

export default function SettingsPage({ showKPI, onToggleKPI }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // key currently being saved

  // Daily email settings (from app_settings)
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState([]); // array of email strings
  const [emailTime, setEmailTime] = useState('21:00');
  const [newEmail, setNewEmail] = useState('');

  // Test email
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const settings = await api('/api/settings/app');
      setEmailEnabled(settings.daily_email_enabled === 'true');
      setEmailRecipients(
        (settings.daily_email_recipients || '').split(',').map(e => e.trim()).filter(Boolean)
      );
      setEmailTime(settings.daily_email_time || '21:00');
    } catch (e) { console.error('Failed to load settings:', e); }
    finally { setLoading(false); }
  }

  async function saveSetting(key, value) {
    setSaving(key);
    try {
      await api('/api/settings/app', {
        method: 'PUT',
        body: JSON.stringify({ key, value })
      });
    } catch (e) { console.error('Failed to save setting:', e); }
    finally { setSaving(null); }
  }

  async function addRecipient() {
    const email = newEmail.trim().toLowerCase();
    if (!email || emailRecipients.includes(email)) return;
    const updated = [...emailRecipients, email];
    setEmailRecipients(updated);
    setNewEmail('');
    await saveSetting('daily_email_recipients', updated.join(','));
  }

  async function removeRecipient(email) {
    const updated = emailRecipients.filter(e => e !== email);
    setEmailRecipients(updated);
    await saveSetting('daily_email_recipients', updated.join(','));
  }

  async function handleSendTestEmail() {
    setTestSending(true);
    setTestResult(null);
    try {
      const result = await api('/api/email/daily-report', { method: 'POST' });
      setTestResult({ success: true, ...result });
    } catch (e) {
      setTestResult({ success: false, error: e.message });
    } finally { setTestSending(false); }
  }

  if (loading) return <div className="loading-spinner"><div className="spinner" />Loading settings...</div>;

  const inputStyle = {
    padding: '8px 12px', border: '1px solid #dee2e6', borderRadius: '6px',
    fontSize: '13px', outline: 'none', width: '100%', boxSizing: 'border-box'
  };

  const labelStyle = {
    fontSize: '11px', fontWeight: 600, color: '#868e96',
    textTransform: 'uppercase', display: 'block', marginBottom: '4px', letterSpacing: '0.5px'
  };

  return (
    <div style={{ maxWidth: '700px' }}>

      {/* ── Display Settings ── */}
      <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#343a40', marginBottom: '16px' }}>Display Settings</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
          <div>
            <div style={{ fontSize: '13px', color: '#495057' }}>Show KPI Cards</div>
            <div style={{ fontSize: '11px', color: '#adb5bd', marginTop: '2px' }}>Display summary cards above reports</div>
          </div>
          <div className={`toggle ${showKPI ? 'on' : ''}`} onClick={onToggleKPI}>
            <div className="toggle-knob" />
          </div>
        </div>
      </div>

      {/* ── Daily Email Report ── */}
      <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#343a40', marginBottom: '4px' }}>Daily Email Report</h3>
          <div style={{ fontSize: '12px', color: '#868e96' }}>
            Sends every morning with yesterday's production data and MTD performance.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

          {/* Enable toggle + Send time */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                className={`toggle ${emailEnabled ? 'on' : ''}`}
                onClick={async () => {
                  const next = !emailEnabled;
                  setEmailEnabled(next);
                  await saveSetting('daily_email_enabled', String(next));
                }}
              >
                <div className="toggle-knob" />
              </div>
              <span style={{ fontSize: '13px', color: '#495057', fontWeight: 500 }}>
                {emailEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#868e96', whiteSpace: 'nowrap' }}>Send time (Pacific)</label>
              <input
                type="time"
                value={emailTime}
                onChange={(e) => setEmailTime(e.target.value)}
                onBlur={() => saveSetting('daily_email_time', emailTime)}
                style={{ ...inputStyle, width: '130px' }}
              />
              {saving === 'daily_email_time' && (
                <span style={{ fontSize: '11px', color: '#adb5bd' }}>Saving…</span>
              )}
            </div>
          </div>

          {/* From address — read-only */}
          <div>
            <label style={labelStyle}>From Address</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                padding: '8px 12px', background: '#f8f9fa', border: '1px solid #dee2e6',
                borderRadius: '6px', fontSize: '13px', color: '#495057', flex: 1
              }}>
                ghernandez@pct.com
              </div>
              <span style={{ fontSize: '11px', color: '#adb5bd', flexShrink: 0 }}>
                Configured in SendGrid — contact admin to change
              </span>
            </div>
          </div>

          {/* Recipients */}
          <div>
            <label style={labelStyle}>Recipients</label>

            {/* Email chips */}
            {emailRecipients.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {emailRecipients.map(email => (
                  <div
                    key={email}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '4px 10px', background: '#e8f4fd', border: '1px solid #74c0fc',
                      borderRadius: '20px', fontSize: '12px', color: '#1971c2'
                    }}
                  >
                    {email}
                    <span
                      onClick={() => removeRecipient(email)}
                      title="Remove"
                      style={{ cursor: 'pointer', color: '#4dabf7', fontWeight: 700, fontSize: '15px', lineHeight: '1', marginTop: '-1px' }}
                    >
                      ×
                    </span>
                  </div>
                ))}
              </div>
            )}

            {emailRecipients.length === 0 && (
              <div style={{ fontSize: '12px', color: '#adb5bd', marginBottom: '10px', fontStyle: 'italic' }}>
                No recipients — email will not send until at least one is added.
              </div>
            )}

            {/* Add email input */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
                placeholder="name@company.com"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={addRecipient}
                disabled={!newEmail.trim()}
                className="btn-primary"
                style={{ whiteSpace: 'nowrap', padding: '8px 16px' }}
              >
                Add
              </button>
            </div>
            {saving === 'daily_email_recipients' && (
              <div style={{ fontSize: '11px', color: '#adb5bd', marginTop: '4px' }}>Saving…</div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', paddingTop: '4px', borderTop: '1px solid #f1f3f5', marginTop: '2px' }}>
            <button
              onClick={handleSendTestEmail}
              disabled={testSending}
              className="btn-accent"
            >
              {testSending ? 'Sending…' : '✉ Send Test Email'}
            </button>
            <a
              href={`${API_BASE}/api/email/daily-report/preview`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '8px 16px' }}
            >
              Preview Email ↗
            </a>
          </div>

          {testResult && (
            <div style={{
              padding: '10px 14px', borderRadius: '6px', fontSize: '13px',
              background: testResult.success ? '#ecfdf5' : '#fef2f2',
              color: testResult.success ? '#065f46' : '#991b1b'
            }}>
              {testResult.success
                ? testResult.sent
                  ? `✓ Sent to: ${(testResult.recipients || []).join(', ')}`
                  : `Not sent: ${testResult.reason}`
                : `Error: ${testResult.error}`
              }
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
