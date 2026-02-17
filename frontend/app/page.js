'use client';

import { useState, useEffect } from 'react';
import { isAuthenticated, logout } from '../lib/auth';
import { api } from '../lib/api';
import LoginPage from '../components/LoginPage';
import MonthSelector from '../components/MonthSelector';
import DailyRevenueReport from '../components/DailyRevenueReport';
import R14BranchesReport from '../components/R14BranchesReport';
import R14RankingReport from '../components/R14RankingReport';
import TitleOfficerReport from '../components/TitleOfficerReport';
import EscrowProductionReport from '../components/EscrowProductionReport';
import FetchManager from '../components/FetchManager';

const TABS = [
  { id: 'daily-revenue', label: 'Daily Revenue', endpoint: '/api/reports/daily-revenue' },
  { id: 'r14-branches', label: 'R-14 Branches', endpoint: '/api/reports/r14-branches' },
  { id: 'r14-ranking', label: 'R-14 Ranking', endpoint: '/api/reports/r14-ranking' },
  { id: 'title-officer', label: 'Title Officer', endpoint: '/api/reports/title-officer' },
  { id: 'escrow', label: 'Escrow Production', endpoint: '/api/reports/escrow-production' },
  { id: 'data', label: 'Data Manager', endpoint: null },
];

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState('daily-revenue');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Check auth on mount
  useEffect(() => {
    setAuthed(isAuthenticated());
  }, []);

  // Fetch report data when tab or month changes
  useEffect(() => {
    if (!authed) return;
    const tab = TABS.find(t => t.id === activeTab);
    if (!tab || !tab.endpoint) return;

    setLoading(true);
    setError(null);

    api(`${tab.endpoint}?month=${month}&year=${year}`)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [authed, activeTab, month, year]);

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  const handleMonthChange = (m, y) => {
    setMonth(m);
    setYear(y);
  };

  const handleLogout = () => {
    logout();
    setAuthed(false);
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">PCT Management Reports</h1>
            <p className="text-xs text-gray-500">Pacific Coast Title</p>
          </div>
          <div className="flex items-center gap-4">
            {activeTab !== 'data' && (
              <MonthSelector month={month} year={year} onChange={handleMonthChange} />
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-[1600px] mx-auto px-4">
          <nav className="flex gap-1 -mb-px">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => { setData(null); setActiveTab(tab.id); }}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-[1600px] mx-auto px-4 py-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">
              <svg className="animate-spin h-6 w-6 mx-auto mb-2" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading report...
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {activeTab === 'daily-revenue' && <DailyRevenueReport data={data} />}
            {activeTab === 'r14-branches' && <R14BranchesReport data={data} />}
            {activeTab === 'r14-ranking' && <R14RankingReport data={data} />}
            {activeTab === 'title-officer' && <TitleOfficerReport data={data} />}
            {activeTab === 'escrow' && <EscrowProductionReport data={data} />}
            {activeTab === 'data' && <FetchManager />}
          </>
        )}
      </main>
    </div>
  );
}
