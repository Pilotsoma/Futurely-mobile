import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import { api } from './client'
import { ApiRequestError } from './client'
import { API_BASE_URL } from '../constants/api'
import { clearTokens, loadTokens, storeTokens } from '../utils/storage'
import type { AuthUser, LoginRequest, MeResponse, RegisterRequest, SendOtpRequest } from '../types/auth'

WebBrowser.maybeCompleteAuthSession()

interface AuthResult {
  token: string
  refreshToken: string
  user: AuthUser
}

export interface GoogleSignInResult {
  token: string
  refreshToken: string
  isNew: boolean
}

export async function login(payload: LoginRequest): Promise<AuthResult> {
  const result = await api.post<AuthResult>('/auth/login', payload, { skipAuth: true })
  await storeTokens({ accessToken: result.token, refreshToken: result.refreshToken })
  return result
}

export async function register(payload: RegisterRequest): Promise<AuthResult> {
  const result = await api.post<AuthResult>('/auth/register', payload, { skipAuth: true })
  await storeTokens({ accessToken: result.token, refreshToken: result.refreshToken })
  return result
}

export async function sendOtp(payload: SendOtpRequest): Promise<{ sent: true }> {
  return api.post('/auth/send-otp', payload, { skipAuth: true })
}

export async function getMe(): Promise<MeResponse> {
  return api.get('/auth/me')
}

export async function logout(): Promise<void> {
  const stored = await loadTokens()
  try {
    await api.post('/auth/logout', stored ? { refreshToken: stored.refreshToken } : undefined)
  } catch {
    // Best-effort server-side revocation — always clear the local session regardless.
  } finally {
    await clearTokens()
  }
}

export async function deleteAccount(password?: string): Promise<void> {
  await api.delete('/auth/account', password ? { password } : undefined)
  await clearTokens()
}

// Backend's OAuth completion is cookie-based (browser-only) — mobile carries a
// redirectUri through the signed `state` so the callback hands tokens back via
// a deep-link redirect instead. See backend/src/routes/auth.ts finishOAuth().
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const redirectUri = AuthSession.makeRedirectUri()
  const authUrl = `${API_BASE_URL}/auth/oauth/google?platform=mobile&redirectUri=${encodeURIComponent(redirectUri)}`

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri)
  if (result.type !== 'success' || !result.url) {
    throw new ApiRequestError('Google sign-in was cancelled.', 0, 'OAUTH_CANCELLED')
  }

  const parsed = new URL(result.url)
  if (parsed.searchParams.get('error')) {
    throw new ApiRequestError('Google sign-in failed. Please try again.', 0, 'OAUTH_FAILED')
  }

  const token = parsed.searchParams.get('token')
  const refreshToken = parsed.searchParams.get('refreshToken')
  if (!token || !refreshToken) {
    throw new ApiRequestError('Google sign-in failed. Please try again.', 0, 'OAUTH_FAILED')
  }

  await storeTokens({ accessToken: token, refreshToken })
  return { token, refreshToken, isNew: parsed.searchParams.get('isNew') === 'true' }
}
