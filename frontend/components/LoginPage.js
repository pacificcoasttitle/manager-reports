'use client';

import { useState } from 'react';
import { login } from '../lib/auth';

export default function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (login(password)) {
        onLogin();
      } else {
        setError('Invalid password');
        setPassword('');
        setLoading(false);
      }
    }, 400);
  };

  return (
    <div className="auth-wrap">
      {/* Left brand panel */}
      <div className="auth-brand">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />

        <div className="auth-brand-top">
          <img src="/logo2.png" alt="Pacific Coast Title" className="auth-brand-logo" />
        </div>

        <div className="auth-brand-mid">
          <p className="auth-brand-eyebrow">Pacific Coast Title</p>
          <h1 className="auth-brand-title">Management Reports</h1>
          <p className="auth-brand-sub">
            Real-time production analytics, revenue tracking, and team performance —
            all in one secure dashboard.
          </p>
        </div>

        <div className="auth-brand-foot">
          © {new Date().getFullYear()} Pacific Coast Title Company
        </div>
      </div>

      {/* Right form panel */}
      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-logo">
            <img src="/logo2.png" alt="Pacific Coast Title" />
          </div>

          <h2 className="auth-h1">Welcome back</h2>
          <p className="auth-sub">Enter your password to access the dashboard.</p>

          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label className="auth-label">Password</label>
              <div className="auth-input-wrap">
                <svg className="auth-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  className="auth-input"
                  placeholder="Enter your password"
                  autoFocus
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPw ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {error && (
                <div className="auth-error">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {error}
                </div>
              )}
            </div>

            <button type="submit" className="auth-btn" disabled={loading || !password}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="auth-spinner" />
                  Signing in…
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="auth-foot">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Protected by Pacific Coast Title IT
          </div>
        </div>
      </div>
    </div>
  );
}
