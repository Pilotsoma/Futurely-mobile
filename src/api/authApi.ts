import { api } from './client'
import { clearTokens, loadTokens, storeTokens } from '../utils/storage'
import type { AuthUser, LoginRequest, MeResponse, RegisterRequest, SendOtpRequest } from '../types/auth'

interface AuthResult {
  token: string
  refreshToken: string
  user: AuthUser
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
