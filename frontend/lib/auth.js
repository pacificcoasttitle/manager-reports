import { getCookie, setCookie, deleteCookie } from 'cookies-next';

const AUTH_COOKIE = 'pct_auth';
// Simple password - change this to whatever you want
const VALID_PASSWORD = 'pct2026';

export function login(password) {
  if (password === VALID_PASSWORD) {
    setCookie(AUTH_COOKIE, 'authenticated', { maxAge: 60 * 60 * 24 * 7 }); // 7 days
    return true;
  }
  return false;
}

export function logout() {
  deleteCookie(AUTH_COOKIE);
}

export function isAuthenticated() {
  return getCookie(AUTH_COOKIE) === 'authenticated';
}
