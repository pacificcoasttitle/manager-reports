'use client';

import { useState } from 'react';
import { login } from '../lib/auth';

export default function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    // Small delay for feel
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
    <div className="login-container">
      {/* Background decoration */}
      <div className="login-bg-orb login-bg-orb-1" />
      <div className="login-bg-orb login-bg-orb-2" />
      <div className="login-bg-orb login-bg-orb-3" />

      <div className="login-card">
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div className="login-logo-wrapper">
            <img src="/logo2.png" alt="Pacific Coast Title" className="login-logo" />
          </div>
          <h1 className="login-title">Management Reports</h1>
          <p className="login-subtitle">Secure access to your reporting dashboard</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label className="login-label">Password</label>
            <div className="login-input-wrapper">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#adb5bd" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                className="login-input"
                placeholder="Enter your password"
                autoFocus
              />
            </div>
            {error && (
              <div className="login-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}
          </div>

          <button type="submit" className="login-btn" disabled={loading || !password}>
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="login-spinner" />
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="login-footer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Protected by Pacific Coast Title IT
        </div>
      </div>
    </div>
  );
}
