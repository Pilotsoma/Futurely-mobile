// Auth domain API — wraps /api/auth/* endpoints.
//
// Auth model (confirmed from backend/src/routes/auth.ts):
//   - Futurely account: email + password → POST /api/auth/login → { token, refreshToken, user }
//   - Token type: JWT, 15-minute access + 7-day rotating refresh.
//   - Mobile sends refresh token in request body (not cookie) — backend reads
//     req.body.refreshToken OR cookies.refresh_token; mobile has no cookies.
//   - GET /api/auth/me is the lightweight session-validation endpoint.
//
// School portal connection lives in gradesApi.ts (POST /api/grades/hac/login, etc.)
// — it is a separate step performed after the Futurely login.

import { apiGet, apiPost, apiDelete } from './client'

export interface AuthUser {
  id: number
  email: string
  name: string | null
  role: string
  emailVerified: boolean
}

export interface LoginResponse {
  token: string
  refreshToken: string
  user: AuthUser
}

export interface RefreshResponse {
  token: string
  refreshToken: string
}

export interface RegisterPayload {
  email: string
  password: string
  name?: string
  dateOfBirth: string // YYYY-MM-DD
  otp: string
}

// POST /api/auth/login — email+password login.
export function login(email: string, password: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/auth/login', { email, password })
}

// POST /api/auth/register — new account creation with OTP verification.
export function register(payload: RegisterPayload): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/auth/register', payload)
}

// POST /api/auth/refresh — rotate access + refresh tokens.
// Mobile passes refreshToken in the request body (no cookies available).
export function refreshTokens(refreshToken: string): Promise<RefreshResponse> {
  return apiPost<RefreshResponse>('/auth/refresh', { refreshToken })
}

// POST /api/auth/logout — server-side revocation of the refresh token.
export function logout(accessToken: string, refreshToken: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/auth/logout', { refreshToken }, accessToken)
}

// GET /api/auth/me — lightweight auth check; returns the current user.
// Used on app launch to verify a stored token is still valid before
// showing the main app. Cheap: no school-portal scraping involved.
export function getMe(accessToken: string): Promise<AuthUser> {
  return apiGet<AuthUser>('/auth/me', accessToken)
}

// POST /api/auth/send-otp — sends a 6-digit OTP to the given email for registration.
export function sendOtp(email: string): Promise<{ sent: boolean }> {
  return apiPost<{ sent: boolean }>('/auth/send-otp', { email })
}

// DELETE /api/auth/account — hard-deletes the account (cascades to all related records).
// Password accounts must pass their current password for verification; OAuth-only
// accounts (no passwordHash) omit it.
export function deleteAccount(password: string | undefined, token: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>('/auth/account', password !== undefined ? { password } : undefined, token)
}
