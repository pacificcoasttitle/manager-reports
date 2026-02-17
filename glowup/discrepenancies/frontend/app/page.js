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
import FetchManager from '../components/FetchManager';
import TessaChat from '../components/TessaChat';
import SettingsPage from '../components/SettingsPage';
import DiscrepanciesReport from '../components/DiscrepanciesReport';

const NAV_ITEMS = [
  { id: 'daily-revenue', label: 'Daily Revenue', icon: '📊', endpoint: '/api/reports/daily-revenue', section: 'reports' },
  { id: 'r14-branches', label: 'R-14 Branches', icon: '🏢', endpoint: '/api/reports/r14-branches', section: 'reports' },
  { id: 'r14-ranking', label: 'R-14 Ranking', icon: '🏆', endpoint: '/api/reports/r14-ranking', section: 'reports' },
  { id: 'title-officer', label: 'Title Officer', icon: '📋', endpoint: '/api/reports/title-officer', section: 'reports' },
  { id: 'escrow', label: 'Escrow Production', icon: '📑', endpoint: '/api/reports/escrow-production', section: 'reports' },
  { id: 'discrepancies', label: 'Discrepancies', icon: '⚠️', endpoint: null, section: 'reports' },
  { id: 'tessa', label: 'Ask Tessa', icon: '🟠', endpoint: null, section: 'ai' },
  { id: 'data', label: 'Data Manager', icon: '⚙️', endpoint: null, section: 'admin' },
  { id: 'settings', label: 'Settings', icon: '⚙️', endpoint: null, section: 'admin' },
];

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
    <div style={{ display: 'flex' }}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>PCT Reports</h1>
          <p>Pacific Coast Title</p>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Reports</div>
          {NAV_ITEMS.filter(n => n.section === 'reports').map(nav => (
            <div
              key={nav.id}
              className={`nav-item ${activeTab === nav.id ? 'active' : ''}`}
              onClick={() => handleNav(nav.id)}
            >
              <span>{nav.icon}</span>
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
              <span>{nav.icon}</span>
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
              <span>{nav.icon}</span>
              <span>{nav.label}</span>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div
            className="nav-item"
            onClick={() => { logout(); setAuthed(false); }}
          >
            <span>↩</span>
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
          <KPICards data={data} dates={dates} />
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

function KPICards({ data, dates }) {
  let totalRevMTD = 0;
  let totalOrdersMTD = 0;
  let totalRevPrior = 0;
  let projectedRev = 0;

  if (data?.grandTotal) {
    totalRevMTD = data.grandTotal.mtd_rev || 0;
    totalOrdersMTD = data.grandTotal.mtd_closed || 0;
    totalRevPrior = data.grandTotal.prior_rev || 0;
  } else if (data?.ranking) {
    totalRevMTD = data.ranking.reduce((s, r) => s + r.mtd_rev, 0);
    totalOrdersMTD = data.ranking.reduce((s, r) => s + r.mtd_cnt, 0);
    totalRevPrior = data.ranking.reduce((s, r) => s + r.prior_rev, 0);
    projectedRev = data.ranking.reduce((s, r) => s + r.projected_rev, 0);
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


