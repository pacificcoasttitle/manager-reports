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

  // Officer emails (per-title-officer)
  const [officers, setOfficers] = useState([]);
  const [officerEmailsEnabled, setOfficerEmailsEnabled] = useState(false);
  const [officerEmailsTime, setOfficerEmailsTime] = useState('05:00');
  const [officerSaving, setOfficerSaving] = useState(null); // officer_name being saved
  const [officerTestSending, setOfficerTestSending] = useState(false);
  const [officerTestResult, setOfficerTestResult] = useState(null);

  // Sales manager emails
  const [managers, setManagers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [availableReps, setAvailableReps] = useState([]);
  const [managerEmailsEnabled, setManagerEmailsEnabled] = useState(false);
  const [mgrSaving, setMgrSaving] = useState(null);
  const [mgrTestSending, setMgrTestSending] = useState(false);
  const [mgrTestResult, setMgrTestResult] = useState(null);
  const [newMgrName, setNewMgrName] = useState('');
  const [newMgrEmail, setNewMgrEmail] = useState('');
  const [assignRep, setAssignRep] = useState('');
  const [assignMgr, setAssignMgr] = useState('');

  // Sales rep emails (per rep, from rep_manager_assignments)
  const [repEmails, setRepEmails] = useState([]);
  const [repEmailsEnabled, setRepEmailsEnabled] = useState(false);
  const [repSaving, setRepSaving] = useState(null); // sales_rep being saved
  const [repSampleSending, setRepSampleSending] = useState(false);
  const [repFullSending, setRepFullSending] = useState(false);
  const [repTestResult, setRepTestResult] = useState(null);

  useEffect(() => { loadSettings(); }, []);

  async function refreshManagers() {
    try {
      const data = await api('/api/admin/managers');
      setManagers(data.managers || []);
      setAssignments(data.assignments || []);
      setAvailableReps(data.availableReps || []);
    } catch (e) { console.error('Failed to load managers:', e); }
  }

  async function refreshRepEmails() {
    try {
      const data = await api('/api/admin/rep-emails');
      setRepEmails(data.reps || []);
      setRepEmailsEnabled(!!data.enabled);
    } catch (e) { console.error('Failed to load rep emails:', e); }
  }

  async function saveRep(salesRep, patch) {
    setRepSaving(salesRep);
    setRepEmails(prev => prev.map(r => r.sales_rep === salesRep ? { ...r, ...patch } : r));
    try {
      await api(`/api/admin/rep-emails/${encodeURIComponent(salesRep)}`, {
        method: 'PUT', body: JSON.stringify(patch)
      });
    } catch (e) { console.error('Failed to save rep:', e); }
    finally { setRepSaving(null); }
  }

  async function handleSendRepSample() {
    setRepSampleSending(true);
    setRepTestResult(null);
    try {
      const result = await api('/api/email/rep-emails/test-sample', {
        method: 'POST', body: JSON.stringify({ email: 'ghernandez@pct.com' })
      });
      setRepTestResult({ success: true, mode: 'sample', ...result });
    } catch (e) {
      setRepTestResult({ success: false, error: e.message });
    } finally { setRepSampleSending(false); }
  }

  async function handleSendRepFull() {
    if (!window.confirm('This sends EVERY active rep email (~37) to ghernandez@pct.com. Continue?')) return;
    setRepFullSending(true);
    setRepTestResult(null);
    try {
      const result = await api('/api/email/rep-emails/test', {
        method: 'POST', body: JSON.stringify({ email: 'ghernandez@pct.com' })
      });
      setRepTestResult({ success: true, mode: 'full', ...result });
    } catch (e) {
      setRepTestResult({ success: false, error: e.message });
    } finally { setRepFullSending(false); }
  }

  async function loadSettings() {
    try {
      const settings = await api('/api/settings/app');
      setEmailEnabled(settings.daily_email_enabled === 'true');
      setEmailRecipients(
        (settings.daily_email_recipients || '').split(',').map(e => e.trim()).filter(Boolean)
      );
      setEmailTime(settings.daily_email_time || '21:00');
      setOfficerEmailsEnabled(settings.officer_emails_enabled === 'true');
      setOfficerEmailsTime(settings.officer_emails_time || '05:00');
      setManagerEmailsEnabled(settings.manager_emails_enabled === 'true');
    } catch (e) { console.error('Failed to load settings:', e); }
    try {
      const list = await api('/api/email/officer-recipients');
      setOfficers(Array.isArray(list) ? list : []);
    } catch (e) { console.error('Failed to load officer recipients:', e); }
    await refreshManagers();
    await refreshRepEmails();
    setLoading(false);
  }

  async function saveManager(managerName, patch) {
    setMgrSaving(managerName);
    setManagers(prev => prev.map(m => m.manager_name === managerName ? { ...m, ...patch } : m));
    try {
      await api(`/api/admin/managers/${encodeURIComponent(managerName)}`, {
        method: 'PUT', body: JSON.stringify(patch)
      });
    } catch (e) { console.error('Failed to save manager:', e); }
    finally { setMgrSaving(null); }
  }

  async function addManager() {
    const name = newMgrName.trim();
    const email = newMgrEmail.trim().toLowerCase();
    if (!name || !email) return;
    try {
      await api('/api/admin/managers', { method: 'POST', body: JSON.stringify({ manager_name: name, email }) });
      setNewMgrName(''); setNewMgrEmail('');
      await refreshManagers();
    } catch (e) { console.error('Failed to add manager:', e); }
  }

  async function assignRepToManager() {
    if (!assignRep || !assignMgr) return;
    try {
      await api('/api/admin/assignments', { method: 'POST', body: JSON.stringify({ sales_rep: assignRep, manager_name: assignMgr }) });
      setAssignRep('');
      await refreshManagers();
    } catch (e) { console.error('Failed to assign rep:', e); }
  }

  async function unassignRep(salesRep) {
    try {
      await api(`/api/admin/assignments/${encodeURIComponent(salesRep)}`, { method: 'DELETE' });
      await refreshManagers();
    } catch (e) { console.error('Failed to unassign rep:', e); }
  }

  async function handleSendManagerTest() {
    setMgrTestSending(true);
    setMgrTestResult(null);
    try {
      const result = await api('/api/email/manager-emails/test', {
        method: 'POST', body: JSON.stringify({ email: 'ghernandez@pct.com' })
      });
      setMgrTestResult({ success: true, ...result });
    } catch (e) {
      setMgrTestResult({ success: false, error: e.message });
    } finally { setMgrTestSending(false); }
  }

  async function saveOfficer(officerName, patch) {
    setOfficerSaving(officerName);
    setOfficers(prev => prev.map(o => o.officer_name === officerName ? { ...o, ...patch } : o));
    try {
      await api(`/api/email/officer-recipients/${encodeURIComponent(officerName)}`, {
        method: 'PUT', body: JSON.stringify(patch)
      });
    } catch (e) { console.error('Failed to save officer:', e); }
    finally { setOfficerSaving(null); }
  }

  async function handleSendOfficerTest() {
    setOfficerTestSending(true);
    setOfficerTestResult(null);
    try {
      const result = await api('/api/email/officer-emails/test', {
        method: 'POST', body: JSON.stringify({ email: 'ghernandez@pct.com' })
      });
      setOfficerTestResult({ success: true, ...result });
    } catch (e) {
      setOfficerTestResult({ success: false, error: e.message });
    } finally { setOfficerTestSending(false); }
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

      {/* ── Officer Emails (per Title Officer) ── */}
      <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#343a40', marginBottom: '4px' }}>Officer Emails</h3>
          <div style={{ fontSize: '12px', color: '#868e96' }}>
            Each title officer gets a personalized daily email with only their own production (yesterday + MTD). Sent individually — no officer sees another's numbers.
          </div>
        </div>

        {/* Master enable toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <div
            className={`toggle ${officerEmailsEnabled ? 'on' : ''}`}
            onClick={async () => {
              const next = !officerEmailsEnabled;
              setOfficerEmailsEnabled(next);
              await saveSetting('officer_emails_enabled', String(next));
            }}
          >
            <div className="toggle-knob" />
          </div>
          <span style={{ fontSize: '13px', color: '#495057', fontWeight: 500 }}>
            Daily send {officerEmailsEnabled ? 'enabled' : 'disabled'}
          </span>
          <span style={{ fontSize: '12px', color: '#868e96' }}>
            · {(() => { const [h, m] = officerEmailsTime.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${String(m).padStart(2, '0')} ${ap} Pacific`; })()}
          </span>
          {saving === 'officer_emails_enabled' && (
            <span style={{ fontSize: '11px', color: '#adb5bd' }}>Saving…</span>
          )}
        </div>

        {/* Officer list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {officers.map(o => (
            <div key={o.officer_name} style={{
              display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
              padding: '10px 12px', background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '6px'
            }}>
              <div style={{ width: '140px', fontSize: '13px', fontWeight: 600, color: '#343a40' }}>
                {o.officer_name}
                <span style={{ fontSize: '10px', color: '#adb5bd', fontWeight: 500, marginLeft: '6px' }}>{o.officer_type}</span>
              </div>
              <input
                type="email"
                defaultValue={o.email}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== o.email) saveOfficer(o.officer_name, { email: v }); }}
                style={{ ...inputStyle, flex: 1, minWidth: '180px' }}
              />
              <div
                className={`toggle ${o.is_active ? 'on' : ''}`}
                onClick={() => saveOfficer(o.officer_name, { is_active: !o.is_active })}
                title={o.is_active ? 'Active' : 'Inactive'}
              >
                <div className="toggle-knob" />
              </div>
              <a
                href={`${API_BASE}/api/email/officer-preview/${encodeURIComponent(o.officer_name)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '12px', color: '#1971c2', textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                Preview ↗
              </a>
              {officerSaving === o.officer_name && (
                <span style={{ fontSize: '11px', color: '#adb5bd' }}>Saving…</span>
              )}
            </div>
          ))}
          {officers.length === 0 && (
            <div style={{ fontSize: '12px', color: '#adb5bd', fontStyle: 'italic' }}>No officers configured.</div>
          )}
        </div>

        {/* Test batch */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingTop: '14px', borderTop: '1px solid #f1f3f5', marginTop: '14px' }}>
          <button onClick={handleSendOfficerTest} disabled={officerTestSending} className="btn-accent">
            {officerTestSending ? 'Sending…' : '✉ Send Test Batch to Me'}
          </button>
          <span style={{ fontSize: '11px', color: '#adb5bd' }}>
            Sends every active officer's email to ghernandez@pct.com with a TEST banner — no officer receives anything.
          </span>
        </div>

        {officerTestResult && (
          <div style={{
            padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginTop: '10px',
            background: officerTestResult.success ? '#ecfdf5' : '#fef2f2',
            color: officerTestResult.success ? '#065f46' : '#991b1b'
          }}>
            {officerTestResult.success
              ? `✓ Test batch sent to ${officerTestResult.sentTo}: ${(officerTestResult.results || []).filter(r => r.sent).length}/${(officerTestResult.results || []).length} officers`
              : `Error: ${officerTestResult.error}`}
          </div>
        )}
      </div>

      {/* ── Sales Manager Emails ── */}
      <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#343a40', marginBottom: '4px' }}>Sales Manager Emails</h3>
          <div style={{ fontSize: '12px', color: '#868e96' }}>
            Each manager gets a daily email showing only their assigned reps — team summary, reps ranked by MTD revenue, and the team's share of company.
          </div>
        </div>

        {/* Master enable toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <div
            className={`toggle ${managerEmailsEnabled ? 'on' : ''}`}
            onClick={async () => {
              const next = !managerEmailsEnabled;
              setManagerEmailsEnabled(next);
              await saveSetting('manager_emails_enabled', String(next));
            }}
          >
            <div className="toggle-knob" />
          </div>
          <span style={{ fontSize: '13px', color: '#495057', fontWeight: 500 }}>
            Daily send {managerEmailsEnabled ? 'enabled' : 'disabled'}
          </span>
          {saving === 'manager_emails_enabled' && (
            <span style={{ fontSize: '11px', color: '#adb5bd' }}>Saving…</span>
          )}
        </div>

        {/* Manager list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {managers.map(m => {
            const myReps = assignments.filter(a => a.manager_name === m.manager_name);
            return (
              <div key={m.manager_name} style={{ padding: '12px', background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: myReps.length ? '10px' : '0' }}>
                  <div style={{ width: '140px', fontSize: '13px', fontWeight: 600, color: '#343a40' }}>{m.manager_name}</div>
                  <input
                    type="email"
                    defaultValue={m.email}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.email) saveManager(m.manager_name, { email: v }); }}
                    style={{ ...inputStyle, flex: 1, minWidth: '180px' }}
                  />
                  <div
                    className={`toggle ${m.is_active ? 'on' : ''}`}
                    onClick={() => saveManager(m.manager_name, { is_active: !m.is_active })}
                    title={m.is_active ? 'Active' : 'Inactive'}
                  >
                    <div className="toggle-knob" />
                  </div>
                  <a
                    href={`${API_BASE}/api/email/manager-preview/${encodeURIComponent(m.manager_name)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: '12px', color: '#1971c2', textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    Preview ↗
                  </a>
                  {mgrSaving === m.manager_name && (
                    <span style={{ fontSize: '11px', color: '#adb5bd' }}>Saving…</span>
                  )}
                </div>
                {/* Assigned reps */}
                {myReps.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingLeft: '2px' }}>
                    {myReps.map(a => (
                      <div key={a.sales_rep} style={{
                        display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px',
                        background: '#fff', border: '1px solid #dee2e6', borderRadius: '14px', fontSize: '12px', color: '#495057'
                      }}>
                        {a.sales_rep}
                        <span onClick={() => unassignRep(a.sales_rep)} title="Unassign"
                          style={{ cursor: 'pointer', color: '#adb5bd', fontWeight: 700, fontSize: '14px', lineHeight: '1' }}>×</span>
                      </div>
                    ))}
                  </div>
                )}
                {myReps.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#adb5bd', fontStyle: 'italic' }}>No reps assigned — this manager won't receive an email.</div>
                )}
              </div>
            );
          })}
          {managers.length === 0 && (
            <div style={{ fontSize: '12px', color: '#adb5bd', fontStyle: 'italic' }}>No managers yet — add one below.</div>
          )}
        </div>

        {/* Add manager */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
          <input type="text" value={newMgrName} onChange={(e) => setNewMgrName(e.target.value)}
            placeholder="Manager name" style={{ ...inputStyle, flex: 1, minWidth: '140px' }} />
          <input type="email" value={newMgrEmail} onChange={(e) => setNewMgrEmail(e.target.value)}
            placeholder="manager@pct.com" style={{ ...inputStyle, flex: 1, minWidth: '160px' }} />
          <button onClick={addManager} disabled={!newMgrName.trim() || !newMgrEmail.trim()} className="btn-primary" style={{ whiteSpace: 'nowrap', padding: '8px 16px' }}>Add Manager</button>
        </div>

        {/* Assign reps */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap', paddingTop: '12px', borderTop: '1px solid #f1f3f5' }}>
          <span style={{ fontSize: '12px', color: '#868e96', whiteSpace: 'nowrap' }}>Assign rep</span>
          <select value={assignRep} onChange={(e) => setAssignRep(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: '160px' }}>
            <option value="">Select rep…</option>
            {availableReps.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <span style={{ fontSize: '12px', color: '#868e96' }}>to</span>
          <select value={assignMgr} onChange={(e) => setAssignMgr(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: '140px' }}>
            <option value="">Select manager…</option>
            {managers.map(m => <option key={m.manager_name} value={m.manager_name}>{m.manager_name}</option>)}
          </select>
          <button onClick={assignRepToManager} disabled={!assignRep || !assignMgr} className="btn-primary" style={{ whiteSpace: 'nowrap', padding: '8px 16px' }}>Assign</button>
        </div>
        <div style={{ fontSize: '11px', color: '#adb5bd', marginTop: '4px' }}>{availableReps.length} unassigned rep{availableReps.length === 1 ? '' : 's'} remaining</div>

        {/* Test batch */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingTop: '14px', borderTop: '1px solid #f1f3f5', marginTop: '14px' }}>
          <button onClick={handleSendManagerTest} disabled={mgrTestSending} className="btn-accent">
            {mgrTestSending ? 'Sending…' : '✉ Send Test Batch to Me'}
          </button>
          <span style={{ fontSize: '11px', color: '#adb5bd' }}>
            Sends every active manager's email to ghernandez@pct.com with a TEST banner — no manager receives anything.
          </span>
        </div>

        {mgrTestResult && (
          <div style={{
            padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginTop: '10px',
            background: mgrTestResult.success ? '#ecfdf5' : '#fef2f2',
            color: mgrTestResult.success ? '#065f46' : '#991b1b'
          }}>
            {mgrTestResult.success
              ? `✓ Test batch sent to ${mgrTestResult.sentTo}: ${(mgrTestResult.results || []).filter(r => r.sent).length}/${(mgrTestResult.results || []).length} managers`
              : `Error: ${mgrTestResult.error}`}
          </div>
        )}
      </div>

      {/* ── Sales Rep Emails (per rep) ── */}
      <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#343a40', marginBottom: '4px' }}>Sales Rep Emails</h3>
          <div style={{ fontSize: '12px', color: '#868e96' }}>
            Each rep gets a daily email showing only their own production (all business) and their rank within their team. Emails come from the manager assignment list — reps with no email won't receive one.
          </div>
        </div>

        {/* Master enable toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <div
            className={`toggle ${repEmailsEnabled ? 'on' : ''}`}
            onClick={async () => {
              const next = !repEmailsEnabled;
              setRepEmailsEnabled(next);
              try {
                await api('/api/admin/rep-emails-enabled', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
              } catch (e) { console.error('Failed to toggle rep emails:', e); }
            }}
          >
            <div className="toggle-knob" />
          </div>
          <span style={{ fontSize: '13px', color: '#495057', fontWeight: 500 }}>
            Daily send {repEmailsEnabled ? 'enabled' : 'disabled'}
          </span>
        </div>

        {/* Rep list — compact rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflowY: 'auto' }}>
          {repEmails.map(r => (
            <div key={r.sales_rep} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ width: '170px', fontSize: '13px', color: '#343a40' }}>
                {r.sales_rep}
                <span style={{ fontSize: '10px', color: '#adb5bd', marginLeft: '6px' }}>{(r.manager_name || '').split(' ')[0]}</span>
              </div>
              <input
                type="email"
                defaultValue={r.email || ''}
                placeholder="no email — won't receive"
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.email || '')) saveRep(r.sales_rep, { email: v }); }}
                style={{ ...inputStyle, flex: 1, minWidth: '180px' }}
              />
              <div
                className={`toggle ${r.is_active ? 'on' : ''}`}
                onClick={() => saveRep(r.sales_rep, { is_active: !r.is_active })}
                title={r.is_active ? 'Active' : 'Inactive'}
              >
                <div className="toggle-knob" />
              </div>
              <a
                href={`${API_BASE}/api/email/rep-preview/${encodeURIComponent(r.sales_rep)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '12px', color: '#1971c2', textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                Preview ↗
              </a>
              {repSaving === r.sales_rep && (
                <span style={{ fontSize: '11px', color: '#adb5bd' }}>Saving…</span>
              )}
            </div>
          ))}
          {repEmails.length === 0 && (
            <div style={{ fontSize: '12px', color: '#adb5bd', fontStyle: 'italic' }}>No reps yet — assign reps to managers above.</div>
          )}
        </div>

        {/* Test buttons */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', paddingTop: '14px', borderTop: '1px solid #f1f3f5', marginTop: '14px' }}>
          <button onClick={handleSendRepSample} disabled={repSampleSending} className="btn-accent">
            {repSampleSending ? 'Sending…' : '✉ Send 3 Samples to Me'}
          </button>
          <button onClick={handleSendRepFull} disabled={repFullSending} className="btn-primary" style={{ padding: '8px 16px' }}>
            {repFullSending ? 'Sending…' : 'Send All (~37) to Me'}
          </button>
          <span style={{ fontSize: '11px', color: '#adb5bd' }}>
            Samples = Kevin Green, Angeline Wu, Sandra Millar. All goes to ghernandez@pct.com with a TEST banner — no rep receives anything.
          </span>
        </div>

        {repTestResult && (
          <div style={{
            padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginTop: '10px',
            background: repTestResult.success ? '#ecfdf5' : '#fef2f2',
            color: repTestResult.success ? '#065f46' : '#991b1b'
          }}>
            {repTestResult.success
              ? `✓ ${repTestResult.mode === 'sample' ? 'Sample' : 'Full test'} sent to ${repTestResult.sentTo}: ${(repTestResult.results || []).filter(r => r.sent).length}/${(repTestResult.results || []).length} reps`
              : `Error: ${repTestResult.error}`}
          </div>
        )}
      </div>

    </div>
  );
}
