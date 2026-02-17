'use client';

import { useState } from 'react';
import { login } from '../lib/auth';

export default function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (login(password)) {
      onLogin();
    } else {
      setError('Invalid password');
      setPassword('');
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1>PCT Reports</h1>
          <p className="subtitle">Management Reporting Dashboard</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#495057', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              className="login-input"
              placeholder="Enter password"
              autoFocus
            />
            {error && <p style={{ color: '#c62828', fontSize: '12px', marginTop: '6px' }}>{error}</p>}
          </div>

          <button type="submit" className="login-btn">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
