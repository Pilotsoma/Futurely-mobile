import { API_BASE_URL, CRUD_TIMEOUT_MS, isLongRunningEndpoint, LONG_RUNNING_TIMEOUT_MS } from '../constants/api'
import { clearTokens, loadTokens, storeTokens } from '../utils/storage'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export class ApiRequestError extends Error {
  status: number
  code?: string
  /** Present only for endpoints that attach extra top-level fields alongside data/error, e.g. auth's ACCOUNT_LOCKED → secondsRemaining. */
  raw?: unknown

  constructor(message: string, status: number, code?: string, raw?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.raw = raw
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired — please sign in again.')
    this.name = 'SessionExpiredError'
  }
}

interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  /** Skip the Authorization header + refresh flow entirely (login/register/send-otp/refresh itself). */
  skipAuth?: boolean
}

// The backend's error envelope is genuinely inconsistent across routers:
//   - auth/assignments/grades/ai/marketplace: { data: null, error: { code, message } }
//   - colleges:                               { data: null, error: { message } }        (no code)
//   - feed:                                    { error: "message string" }               (bare, no data key)
// Normalize all three into one shape so callers only ever handle ApiRequestError.
function extractError(body: unknown): { message: string; code?: string } {
  const err = (body as { error?: unknown } | null)?.error
  if (typeof err === 'string') return { message: err }
  if (err && typeof err === 'object') {
    const e = err as { message?: string; code?: string }
    return { message: e.message ?? 'Request failed', code: e.code }
  }
  return { message: 'Request failed' }
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, API_BASE_URL)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function rawFetch(
  path: string,
  opts: RequestOptions,
  accessToken: string | null,
): Promise<Response> {
  const timeoutMs = isLongRunningEndpoint(path) ? LONG_RUNNING_TIMEOUT_MS : CRUD_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiRequestError(
        isLongRunningEndpoint(path)
          ? 'This is taking longer than expected. Please try again.'
          : 'Request timed out. Please check your connection and try again.',
        408,
        'TIMEOUT',
      )
    }
    throw new ApiRequestError('Network error. Please check your connection.', 0, 'NETWORK_ERROR')
  } finally {
    clearTimeout(timer)
  }
}

// De-duplicates concurrent refreshes: refresh tokens rotate on every call
// (backend/src/routes/auth.ts revokes the old one and issues a new pair), so
// two parallel 401s must not each fire their own refresh — the second would
// revoke the first's brand-new refresh token before anything used it.
let refreshPromise: Promise<{ token: string; refreshToken: string }> | null = null

async function refreshTokens(): Promise<{ token: string; refreshToken: string }> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const stored = await loadTokens()
    if (!stored) throw new SessionExpiredError()

    // Raw fetch, bypassing request() entirely — a refresh failure must never
    // re-enter the 401 handling below, or it would loop.
    const res = await rawFetch(
      '/auth/refresh',
      { method: 'POST', body: { refreshToken: stored.refreshToken } },
      null,
    )
    const body = (await res.json().catch(() => null)) as {
      data?: { token: string; refreshToken: string }
    } | null

    if (!res.ok || !body?.data) {
      await clearTokens()
      throw new SessionExpiredError()
    }

    await storeTokens({ accessToken: body.data.token, refreshToken: body.data.refreshToken })
    return body.data
  })()

  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

const AUTH_ENDPOINTS_SKIPPING_REFRESH = new Set(['/auth/login', '/auth/register', '/auth/refresh'])

/**
 * Returns the full response envelope. Most endpoints only need `.data` (see
 * `request()` below), but a few — like GET /assignments — also carry a `meta`
 * (cursor pagination) that callers need direct access to.
 */
export async function requestEnvelope<T, M = undefined>(
  path: string,
  opts: RequestOptions = {},
  _isRetry = false,
): Promise<{ data: T; meta?: M }> {
  const stored = opts.skipAuth ? null : await loadTokens()
  const res = await rawFetch(path, opts, stored?.accessToken ?? null)

  const body = (await res.json().catch(() => null)) as { data?: T; meta?: M } | { error?: unknown } | null

  if (res.ok) {
    const envelope = body as { data?: T; meta?: M } | null
    return { data: (envelope?.data ?? (body as unknown as T)) as T, meta: envelope?.meta }
  }

  if (res.status === 401 && !_isRetry && !opts.skipAuth && !AUTH_ENDPOINTS_SKIPPING_REFRESH.has(path)) {
    await refreshTokens() // throws SessionExpiredError if it fails
    return requestEnvelope<T, M>(path, opts, true)
  }

  const { message, code } = extractError(body)
  throw new ApiRequestError(message, res.status, code, body)
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { data } = await requestEnvelope<T>(path, opts)
  return data
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown, opts?: Pick<RequestOptions, 'skipAuth'>) =>
    request<T>(path, { method: 'POST', body, ...opts }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
}
