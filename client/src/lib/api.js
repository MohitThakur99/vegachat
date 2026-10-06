import { getAccessToken, setAccessToken } from './session.js';

export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshTimer = null;
let refreshInFlight = null;
let onSessionLost = () => {};

/** Called when the server says the session is over (refresh rejected). */
export function setSessionLostHandler(handler) {
  onSessionLost = handler;
}

function send(path, { method = 'GET', body, formData, auth = true, cookies = false } = {}) {
  const headers = {};
  const token = getAccessToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: payload,
    // Only the auth endpoints need the refresh cookie.
    credentials: cookies ? 'include' : 'omit',
  });
}

async function parse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (a proxy error page, for instance); fall through to the status.
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'HTTP_ERROR',
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.details,
    );
  }
  return body;
}

/** Stores a new access token and schedules its replacement before it expires. */
export function applySession({ accessToken, expiresIn }) {
  setAccessToken(accessToken);
  clearTimeout(refreshTimer);
  const lifetimeMs = expiresIn * 1000;
  // A minute early, or halfway through for very short lifetimes.
  scheduleRefresh(Math.max(lifetimeMs - 60_000, lifetimeMs / 2));
}

function scheduleRefresh(delayMs) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshSession().catch((err) => {
      // Offline or server down: keep trying. A rejected session was already
      // reported through onSessionLost.
      if (!(err instanceof ApiError)) scheduleRefresh(10_000);
    });
  }, delayMs);
}

export function clearSession() {
  clearTimeout(refreshTimer);
  setAccessToken(null);
}

/**
 * Trades the refresh cookie for a new access token. Concurrent callers share
 * one request, and a Web Lock keeps other tabs from rotating the same cookie
 * at the same time.
 */
export function refreshSession() {
  if (!refreshInFlight) {
    const run = async () => {
      const data = await parse(await send('/api/auth/refresh', { method: 'POST', auth: false, cookies: true }));
      applySession(data);
      return data;
    };
    const pending = navigator.locks ? navigator.locks.request('vegachat-refresh', run) : run();
    refreshInFlight = pending
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onSessionLost();
        throw err;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * JSON request to the API. On a 401 it refreshes the access token once and
 * repeats the request, so an expired token is invisible to callers.
 *
 * @param {string} path
 * @param {{ method?: string, body?: unknown, formData?: FormData, auth?: boolean, cookies?: boolean }} [options]
 */
export async function api(path, options = {}) {
  let response = await send(path, options);
  if (response.status === 401 && options.auth !== false) {
    await refreshSession();
    response = await send(path, options);
  }
  return parse(response);
}

/** Fetches a protected file (attachments) as a Blob. */
export async function fetchBlob(path) {
  let response = await send(path);
  if (response.status === 401) {
    await refreshSession();
    response = await send(path);
  }
  if (!response.ok) throw new ApiError(response.status, 'HTTP_ERROR', 'Could not load the file');
  return response.blob();
}
