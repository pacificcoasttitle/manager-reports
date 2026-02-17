const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://manager-reports.onrender.com';

export async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error: ${res.status}`);
  }

  return res.json();
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num || 0);
}

export function formatPercent(num) {
  return `${(num || 0).toFixed(0)}%`;
}
