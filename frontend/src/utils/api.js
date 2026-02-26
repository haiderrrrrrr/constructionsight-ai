import { broadcastRefresh } from '@/utils/broadcast'
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
export const STREAM_BASE = import.meta.env.VITE_STREAM_BASE || 'http://localhost:8001';

function getAccessToken() {
  return window.sessionStorage.getItem('access_token');
}

function setTokens(accessToken) {
  if (accessToken) window.sessionStorage.setItem('access_token', accessToken);
}

function clearClientAuth(broadcast = true) {
  window.sessionStorage.removeItem('access_token');
  window.sessionStorage.removeItem('cs_session');
  window.localStorage.removeItem('cs_remember');
  if (broadcast) _refreshChannel.postMessage({ type: 'auth:logout_all' })
  window.dispatchEvent(new Event('auth:logout'));
}

function redirectToLogin() {
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

// Cross-tab refresh coordination.
// Problem: with N tabs open and an expired token, all N hit /auth/refresh simultaneously.
// Backend uses token rotation — once tab 1 consumes RT_A → RT_B, tabs 2-N still hold RT_A.
// Backend sees RT_A reused → marks entire family revoked → all tabs log out.
// Solution: Web Locks ensure only one tab runs the refresh at a time. The winning tab
// broadcasts the new token; waiting tabs re-check sessionStorage inside the lock and skip
// the network call entirely.
const _refreshChannel = new BroadcastChannel('cs-token-refresh')

_refreshChannel.onmessage = (e) => {
  if (e.data?.type === 'token_refreshed' && e.data.token) {
    setTokens(e.data.token)
  } else if (e.data?.type === 'token_refresh_failed') {
    clearClientAuth()
  } else if (e.data?.type === 'auth:login') {
    if (e.data.token) setTokens(e.data.token)
    window.dispatchEvent(new Event('auth:login'))
  } else if (e.data?.type === 'auth:logout_all') {
    clearClientAuth(false)
  }
}

export function broadcastLogin(accessToken) {
  _refreshChannel.postMessage({ type: 'auth:login', token: accessToken })
}

// Per-tab mutex: deduplicates concurrent calls within this tab.
let _refreshInFlight = null;

async function _doRefresh() {
  // Re-check inside the lock — another tab may have already refreshed
  const existing = getAccessToken()
  if (existing && isTokenValid()) return existing

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 400 || res.status === 403) {
        _refreshChannel.postMessage({ type: 'token_refresh_failed' })
        clearClientAuth();
      }
      return null;
    }
    const data = await res.json();
    setTokens(data?.access_token);
    // Broadcast new token to all other tabs so they skip their own refresh
    _refreshChannel.postMessage({ type: 'token_refreshed', token: data?.access_token })
    return data?.access_token || null;
  } catch {
    return null;
  }
}

async function refreshTokens() {
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    try {
      // Web Locks API: only ONE tab across all open tabs can hold 'cs-token-refresh' at a time.
      // Other tabs block here until the lock is released, then re-check sessionStorage
      // before hitting the network — so only one refresh call ever reaches the backend.
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return await navigator.locks.request('cs-token-refresh', () => _doRefresh())
      }
      // Fallback for environments without Web Locks (shouldn't happen in modern browsers)
      return await _doRefresh()
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

async function apiFetch(path, options = {}, { retryOn401 = true, timeoutMs, signal: externalSignal } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const doFetch = async (hdrs) => {
    // Merge external abort signal + optional timeout into one controller
    const controller = new AbortController()
    let timer = null
    if (timeoutMs) timer = window.setTimeout(() => controller.abort(), timeoutMs)
    const onExtAbort = () => controller.abort()
    if (externalSignal) externalSignal.addEventListener('abort', onExtAbort)
    try {
      return await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: hdrs,
        credentials: 'include',
        signal: controller.signal,
      })
    } catch (err) {
      if (externalSignal?.aborted || err?.name === 'AbortError') throw err
      throw err
    } finally {
      if (timer) window.clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExtAbort)
    }
  }

  const res = await doFetch(headers)

  if (res.status === 401 && retryOn401) {
    const newAccess = await refreshTokens();
    if (newAccess) {
      const retryHeaders = { ...headers, Authorization: `Bearer ${newAccess}` };
      const retryRes = await doFetch(retryHeaders)
      if (!retryRes.ok) {
        if (retryRes.status === 401) {
          clearClientAuth();
          redirectToLogin();
          return new Promise(() => {});
        }
        const msg = await retryRes.text();
        throw new Error(msg || `Request failed: ${retryRes.status}`);
      }
      // Handle 204 No Content or empty responses
      if (retryRes.status === 204 || retryRes.headers.get('content-length') === '0') {
        return null;
      }
      const data = await retryRes.json();
      const method = String(options.method || 'GET').toUpperCase();
      if (method !== 'GET' && String(path || '').startsWith('/admin/cameras')) {
        broadcastRefresh('cs:cameras-stats-refresh');
      }
      return data;
    }
    redirectToLogin();
    throw new Error('Session expired');
  }

  if (!res.ok) {
    let msg;
    try {
      const data = await res.json();
      msg = JSON.stringify(data);
    } catch {
      msg = await res.text();
    }
    if (res.status === 403 && retryOn401) {
      const lower = String(msg || '').toLowerCase();
      if (
        lower.includes('account disabled') ||
        lower.includes('account deactivated') ||
        lower.includes('account pending approval') ||
        lower.includes('session invalidated')
      ) {
        clearClientAuth();
        redirectToLogin();
        return new Promise(() => {});
      }
    }
    const error = new Error(msg || `Request failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }

  // Handle 204 No Content or empty responses
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return null;
  }

  const data = await res.json();
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET' && String(path || '').startsWith('/admin/cameras')) {
    broadcastRefresh('cs:cameras-stats-refresh');
  }
  return data;
}

export async function apiPost(path, body, opts = {}) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) }, opts);
}

export async function apiGet(path, opts = {}) {
  return apiFetch(path, { method: 'GET' }, opts);
}

export async function apiPatch(path, body, opts = {}) {
  return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }, opts);
}

export async function apiDelete(path, opts = {}) {
  return apiFetch(path, { method: 'DELETE' }, opts);
}

export async function apiUpload(path, file, fieldName = 'file', opts = {}) {
  const formData = (file instanceof FormData) ? file : (() => {
    const fd = new FormData();
    fd.append(fieldName, file);
    return fd;
  })();
  const token = getAccessToken();
  const { headers: extraHeaders, ...restOpts } = opts || {};
  const headers = { ...(extraHeaders || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    ...restOpts,
    headers,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPublicPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw { response: { status: res.status, data } };
  }
  return res.json();
}

function _decodeJwt() {
  const token = getAccessToken();
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export function getPlatformRole() {
  return _decodeJwt()?.platform_role || null;
}

export function getCurrentUserId() {
  return _decodeJwt()?.sub || null;
}


export function isTokenValid() {
  const payload = _decodeJwt();
  if (!payload) return false;
  if (!payload.exp) return true;
  return Date.now() / 1000 < payload.exp;
}

export { refreshTokens };
