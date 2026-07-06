// Typed fetch wrapper for all Futurely API calls.
//
// Design decisions:
// - Two timeout tiers: DEFAULT_TIMEOUT_MS for fast CRUD endpoints,
//   SCRAPE_TIMEOUT_MS for requests that trigger live HAC/PowerSchool scraping.
//   Past sessions showed a short uniform timeout caused scraping failures.
// - Authorization: Bearer <token> is attached when a token is available.
//   Backend middleware (requireAuth) accepts this header from mobile clients.
// - Error shape: { data: null, error: { code: string, message: string } }
//   is the backend's standard — we unpack it into a thrown Error so callers
//   can always display error.message directly without checking { data, error }.
// - Token is injected at call time (not stored in this module) — the caller
//   passes a getToken function so the client stays stateless.

import { API_BASE_URL } from '../constants/api'

// 45 seconds for endpoints that proxy live school portal scraping.
const SCRAPE_TIMEOUT_MS = 45_000
// 10 seconds for regular CRUD endpoints.
const DEFAULT_TIMEOUT_MS = 10_000

export interface ApiError {
  code: string
  message: string
}

// Thrown whenever the backend returns a non-2xx response or an { error } body.
export class ApiRequestError extends Error {
  public readonly code: string
  public readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
  }
}

interface RequestOptions extends Omit<RequestInit, 'signal'> {
  /** Use SCRAPE_TIMEOUT_MS instead of DEFAULT_TIMEOUT_MS. Pass true for /hac/* and /powerschool/* endpoints. */
  isScrapingEndpoint?: boolean
  /** Bearer token — obtained from AuthContext at call time. */
  token?: string | null
}

// Raw JSON fetch with timeout + auth header.
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { isScrapingEndpoint = false, token, ...init } = options
  const timeoutMs = isScrapingEndpoint ? SCRAPE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })
  } catch (err: unknown) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiRequestError(
        isScrapingEndpoint
          ? 'The school portal did not respond in time. Please try again.'
          : 'Request timed out. Please check your connection.',
        'TIMEOUT',
        408,
      )
    }
    throw new ApiRequestError(
      'Could not reach the server. Please check your connection.',
      'NETWORK_ERROR',
      0,
    )
  } finally {
    clearTimeout(timer)
  }

  // Parse JSON — backend always returns JSON even for errors.
  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new ApiRequestError(
      'Unexpected server response.',
      'PARSE_ERROR',
      response.status,
    )
  }

  // Unpack backend error envelope: { data: null, error: { code, message } }
  const body = json as { data?: T; error?: { code?: string; message?: string } }

  if (!response.ok || body.error) {
    const code = body.error?.code ?? 'UNKNOWN_ERROR'
    const message = body.error?.message ?? `Request failed with status ${response.status}`
    throw new ApiRequestError(message, code, response.status)
  }

  return body.data as T
}

// ── Convenience helpers ────────────────────────────────────────────────────────

export function apiGet<T>(
  path: string,
  token?: string | null,
  options?: Omit<RequestOptions, 'method' | 'token'>,
): Promise<T> {
  return request<T>(path, { method: 'GET', token, ...options })
}

export function apiPost<T>(
  path: string,
  body: unknown,
  token?: string | null,
  options?: Omit<RequestOptions, 'method' | 'body' | 'token'>,
): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    token,
    ...options,
  })
}

export function apiPatch<T>(
  path: string,
  body: unknown,
  token?: string | null,
  options?: Omit<RequestOptions, 'method' | 'body' | 'token'>,
): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
    token,
    ...options,
  })
}

export function apiDelete<T>(
  path: string,
  body?: unknown,
  token?: string | null,
  options?: Omit<RequestOptions, 'method' | 'body' | 'token'>,
): Promise<T> {
  return request<T>(path, {
    method: 'DELETE',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    token,
    ...options,
  })
}
