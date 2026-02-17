'use client';

import { useState, useEffect } from 'react';
import { isAuthenticated, logout } from '../lib/auth';
import { api, formatCurrency } from '../lib/api';
import LoginPage from '../components/LoginPage';
import MonthSelector from '../components/MonthSelector';
import DailyRevenueReport from '../components/DailyRevenueReport';
import R14BranchesReport from '../components/R14BranchesReport';
import R14RankingReport from '../components/R14RankingReport';
import TitleOfficerReport from '../components/TitleOfficerReport';
import EscrowProductionReport from '../components/EscrowProductionReport';
import TSGProductionReport from '../components/TSGProductionReport';
import DiscrepanciesReport from '../components/DiscrepanciesReport';
import FetchManager from '../components/FetchManager';
import TessaChat from '../components/TessaChat';
import SettingsPage from '../components/SettingsPage';

const NAV_ITEMS = [
  { id: 'daily-revenue', label: 'Daily Revenue', iconKey: 'chart', endpoint: '/api/reports/daily-revenue', section: 'reports' },
  { id: 'r14-branches', label: 'R-14 Branches', iconKey: 'branches', endpoint: '/api/reports/r14-branches', section: 'reports' },
  { id: 'r14-ranking', label: 'R-14 Ranking', iconKey: 'ranking', endpoint: '/api/reports/r14-ranking', section: 'reports' },
  { id: 'title-officer', label: 'Title Officer', iconKey: 'title', endpoint: '/api/reports/title-officer', section: 'reports' },
  { id: 'escrow', label: 'Escrow Production', iconKey: 'escrow', endpoint: '/api/reports/escrow-production', section: 'reports' },
  { id: 'tsg', label: 'TSG Production', iconKey: 'tsg', endpoint: '/api/reports/tsg-production', section: 'reports' },
  { id: 'discrepancies', label: 'Discrepancies', iconKey: 'discrepancies', endpoint: null, section: 'reports' },
  { id: 'tessa', label: 'Ask Tessa', iconKey: 'tessa', endpoint: null, section: 'ai' },
  { id: 'data', label: 'Data Manager', iconKey: 'database', endpoint: null, section: 'admin' },
  { id: 'settings', label: 'Settings', iconKey: 'settings', endpoint: null, section: 'admin' },
];

function NavIcon({ name, active, tessa }) {
  const color = tessa ? (active ? '#f26b2b' : '#f26b2b') : (active ? '#f26b2b' : 'currentColor');
  const size = 18;
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

  const icons = {
    chart: <svg {...props}><path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 5-9" /></svg>,
    branches: <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
    ranking: <svg {...props}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>,
    title: <svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
    escrow: <svg {...props}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></svg>,
    tsg: <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
    discrepancies: <svg {...props}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
    tessa: <svg {...props} strokeWidth={1.6}><circle cx="12" cy="12" r="3" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M4.93 4.93l1.41 1.41" /><path d="M17.66 17.66l1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="M4.93 19.07l1.41-1.41" /><path d="M17.66 6.34l1.41-1.41" /></svg>,
    database: <svg {...props}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>,
    settings: <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>,
    logout: <svg {...props}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
  };
  return icons[name] || null;
}

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState('daily-revenue');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showKPI, setShowKPI] = useState(true);

  useEffect(() => {
    setAuthed(isAuthenticated());
    const savedKPI = typeof window !== 'undefined' ? localStorage.getItem('pct_show_kpi') : null;
    if (savedKPI !== null) setShowKPI(savedKPI === 'true');
  }, []);

  useEffect(() => {
    if (!authed) return;
    const nav = NAV_ITEMS.find(t => t.id === activeTab);
    if (!nav || !nav.endpoint) return;

    setLoading(true);
    setError(null);

    api(`${nav.endpoint}?month=${month}&year=${year}`)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [authed, activeTab, month, year]);

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const handleNav = (id) => {
    setData(null);
    setActiveTab(id);
  };

  const activeNav = NAV_ITEMS.find(n => n.id === activeTab);
  const isReportTab = activeNav?.section === 'reports';
  const dates = data?.dates;

  const toggleKPI = () => {
    const next = !showKPI;
    setShowKPI(next);
    localStorage.setItem('pct_show_kpi', String(next));
  };

  return (
    <div>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="sidebar-logo-mark">P</div>
            <div>
              <h1>PCT Reports</h1>
              <p>Pacific Coast Title</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Reports</div>
          {NAV_ITEMS.filter(n => n.section === 'reports').map(nav => (
            <div
              key={nav.id}
              className={`nav-item ${activeTab === nav.id ? 'active' : ''}`}
              onClick={() => handleNav(nav.id)}
            >
              <NavIcon name={nav.iconKey} active={activeTab === nav.id} />
              <span>{nav.label}</span>
            </div>
          ))}

          <div className="sidebar-section-label">AI</div>
          {NAV_ITEMS.filter(n => n.section === 'ai').map(nav => (
            <div
              key={nav.id}
              className={`nav-item tessa ${activeTab === nav.id ? 'active' : ''}`}
              onClick={() => handleNav(nav.id)}
            >
              <NavIcon name={nav.iconKey} active={activeTab === nav.id} tessa />
              <span>{nav.label}</span>
            </div>
          ))}

          <div className="sidebar-section-label">Admin</div>
          {NAV_ITEMS.filter(n => n.section === 'admin').map(nav => (
            <div
              key={nav.id}
              className={`nav-item ${activeTab === nav.id ? 'active' : ''}`}
              onClick={() => handleNav(nav.id)}
            >
              <NavIcon name={nav.iconKey} active={activeTab === nav.id} />
              <span>{nav.label}</span>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div
            className="nav-item"
            onClick={() => { logout(); setAuthed(false); }}
          >
            <NavIcon name="logout" />
            <span>Sign Out</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Top Bar */}
        <div className="top-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#343a40' }}>
              {activeNav?.label}
            </span>
            {isReportTab && dates && (
              <div className="working-days-bar">
                <span>
                  <span className="label">Working Days:</span>{' '}
                  {dates.workedDays} of {dates.totalWorkingDays}
                  {dates.remainingWorkingDays > 0 && ` (${dates.remainingWorkingDays} remaining)`}
                </span>
                <div className="working-days-progress">
                  <div
                    className="working-days-progress-fill"
                    style={{ width: `${dates.totalWorkingDays > 0 ? (dates.workedDays / dates.totalWorkingDays * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {isReportTab && (
              <>
                <button
                  onClick={toggleKPI}
                  style={{ fontSize: '11px', color: '#868e96', cursor: 'pointer', background: 'none', border: 'none' }}
                >
                  {showKPI ? 'Hide KPIs' : 'Show KPIs'}
                </button>
                <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
              </>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        {isReportTab && showKPI && data && !loading && (
          <KPICards data={data} dates={dates} activeTab={activeTab} />
        )}

        {/* Content */}
        {loading && (
          <div className="loading-spinner">
            <div className="spinner" />
            Loading report...
          </div>
        )}

        {error && <div className="error-banner"><strong>Error:</strong> {error}</div>}

        {!loading && !error && (
          <div className="report-container">
            {activeTab === 'daily-revenue' && <DailyRevenueReport data={data} />}
            {activeTab === 'r14-branches' && <R14BranchesReport data={data} />}
            {activeTab === 'r14-ranking' && <R14RankingReport data={data} />}
            {activeTab === 'title-officer' && <TitleOfficerReport data={data} />}
            {activeTab === 'escrow' && <EscrowProductionReport data={data} />}
            {activeTab === 'tsg' && <TSGProductionReport data={data} />}
            {activeTab === 'discrepancies' && <DiscrepanciesReport month={month} year={year} />}
            {activeTab === 'tessa' && <TessaChat month={month} year={year} />}
            {activeTab === 'data' && <FetchManager />}
            {activeTab === 'settings' && <SettingsPage showKPI={showKPI} onToggleKPI={toggleKPI} />}
          </div>
        )}
      </main>
    </div>
  );
}

function KPICards({ data, dates, activeTab }) {
  let totalRevMTD = 0;
  let totalOrdersMTD = 0;
  let totalRevPrior = 0;
  let projectedRev = 0;

  if (data?.grandTotal) {
    // Daily Revenue has grandTotal
    totalRevMTD = data.grandTotal.mtd_rev || 0;
    totalOrdersMTD = data.grandTotal.mtd_closed || 0;
    totalRevPrior = data.grandTotal.prior_rev || 0;
  } else if (data?.ranking) {
    // R-14 Ranking has ranking array
    totalRevMTD = data.ranking.reduce((s, r) => s + (r.mtd_rev || 0), 0);
    totalOrdersMTD = data.ranking.reduce((s, r) => s + (r.mtd_cnt || 0), 0);
    totalRevPrior = data.ranking.reduce((s, r) => s + (r.prior_rev || 0), 0);
    projectedRev = data.ranking.reduce((s, r) => s + (r.projected_rev || 0), 0);
  } else if (data?.report && typeof data.report === 'object') {
    // R-14 Branches, Title Officer, Escrow — nested branch → person objects
    Object.values(data.report).forEach(branch => {
      Object.values(branch).forEach(person => {
        if (person && typeof person === 'object') {
          const cats = ['Purchase', 'Refinance', 'Escrow', 'TSG'];
          let hasCats = cats.some(c => person[c]);

          if (hasCats) {
            cats.forEach(cat => {
              if (person[cat]) {
                totalRevMTD += person[cat].mtd_rev || 0;
                totalOrdersMTD += person[cat].mtd_cnt || 0;
                totalRevPrior += person[cat].prior_rev || 0;
              }
            });
          } else {
            // Escrow report — flat per person (today_cnt, mtd_cnt, etc.)
            totalRevMTD += person.mtd_rev || 0;
            totalOrdersMTD += person.mtd_cnt || 0;
            totalRevPrior += person.prior_rev || 0;
          }
        }
      });
    });
  }

  if (dates && dates.workedDays > 0 && !projectedRev) {
    projectedRev = (totalRevMTD / dates.workedDays) * (dates.workedDays + dates.remainingWorkingDays);
  }

  const avgPerOrder = totalOrdersMTD > 0 ? totalRevMTD / totalOrdersMTD : 0;

  return (
    <div className="kpi-grid">
      <div className="kpi-card">
        <div className="kpi-card-label">MTD Revenue</div>
        <div className="kpi-card-value">{formatCurrency(totalRevMTD)}</div>
        <div className="kpi-card-sub">{totalOrdersMTD} orders closed</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-card-label">Projected Revenue</div>
        <div className="kpi-card-value" style={{ color: 'var(--pct-accent)' }}>{formatCurrency(projectedRev)}</div>
        <div className="kpi-card-sub">Based on {dates?.workedDays || 0} working days</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-card-label">Prior Month</div>
        <div className="kpi-card-value">{formatCurrency(totalRevPrior)}</div>
        <div className="kpi-card-sub">{dates?.priorMonthLabel}</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-card-label">Avg Revenue / Order</div>
        <div className="kpi-card-value">{formatCurrency(avgPerOrder)}</div>
        <div className="kpi-card-sub">MTD average</div>
      </div>
    </div>
  );
}
