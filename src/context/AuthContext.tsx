import React, { createContext, useContext, useEffect, useState } from 'react'
import { API_BASE_URL } from '../constants/api'
import {
  clearAllTokens,
  getRefreshToken,
  getToken,
  setRefreshToken,
  setToken,
} from '../utils/auth'

interface User {
  id: number
  email: string
  name: string | null
  role: string
  emailVerified: boolean
}

interface AuthContextValue {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name?: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function tryRefresh(API_BASE_URL: string): Promise<{ token: string; refreshToken: string } | null> {
  const storedRefresh = await getRefreshToken()
  if (!storedRefresh) return null

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: storedRefresh }),
    })
    if (!res.ok) return null

    const { data } = (await res.json()) as { data: { token: string; refreshToken: string } }
    return data
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [token, setTokenState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void bootstrap()
  }, [])

  async function bootstrap(): Promise<void> {
    try {
      const stored = await getToken()
      if (!stored) return

      // Try the stored access token first
      const res = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${stored}` },
      })

      if (res.ok) {
        const { data: userData } = (await res.json()) as { data: User }
        setTokenState(stored)
        setUser(userData)
        return
      }

      // Access token expired — try refresh
      if (res.status === 401) {
        const refreshed = await tryRefresh(API_BASE_URL)
        if (refreshed) {
          await setToken(refreshed.token)
          await setRefreshToken(refreshed.refreshToken)

          const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${refreshed.token}` },
          })
          if (meRes.ok) {
            const { data: userData } = (await meRes.json()) as { data: User }
            setTokenState(refreshed.token)
            setUser(userData)
            return
          }
        }
        // Refresh also failed — clear everything
        await clearAllTokens()
      }
    } catch {
      // Network unavailable on cold launch — stay logged out
    } finally {
      setIsLoading(false)
    }
  }

  async function refreshSession(): Promise<boolean> {
    const refreshed = await tryRefresh(API_BASE_URL)
    if (!refreshed) return false

    await setToken(refreshed.token)
    await setRefreshToken(refreshed.refreshToken)
    setTokenState(refreshed.token)
    return true
  }

  async function login(email: string, password: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      const body = (await res.json()) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? 'Login failed')
    }

    const { data } = (await res.json()) as { data: { token: string; refreshToken: string; user: User } }
    await setToken(data.token)
    await setRefreshToken(data.refreshToken)
    setTokenState(data.token)
    setUser(data.user)
  }

  async function register(email: string, password: string, name?: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })

    if (!res.ok) {
      const body = (await res.json()) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? 'Registration failed')
    }

    const { data } = (await res.json()) as { data: { token: string; refreshToken: string; user: User } }
    await setToken(data.token)
    await setRefreshToken(data.refreshToken)
    setTokenState(data.token)
    setUser(data.user)
  }

  async function logout(): Promise<void> {
    const currentToken = token
    const refreshToken = await getRefreshToken()

    await clearAllTokens()
    setTokenState(null)
    setUser(null)

    // Best-effort server-side revocation — don't block UI on this
    if (currentToken && refreshToken) {
      void fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => { /* network error — local clear is sufficient */ })
    }
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be called inside AuthProvider')
  return ctx
}
