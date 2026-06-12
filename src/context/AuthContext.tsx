import React, { createContext, useContext, useEffect, useState } from 'react'
import { API_BASE_URL } from '../constants/api'
import { clearToken, getToken, setToken } from '../utils/auth'

interface User {
  id: number
  email: string
  name: string | null
  role: string
}

interface AuthContextValue {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [token, setTokenState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function bootstrap(): Promise<void> {
      try {
        const stored = await getToken()
        if (!stored) return

        const res = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${stored}` },
        })

        if (!res.ok) {
          await clearToken()
          return
        }

        const { data: userData } = (await res.json()) as { data: User }
        setTokenState(stored)
        setUser(userData)
      } catch {
        // network unavailable on cold launch — stay logged out
      } finally {
        setIsLoading(false)
      }
    }
    void bootstrap()
  }, [])

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

    const { data } = (await res.json()) as { data: { token: string; user: User } }
    await setToken(data.token)
    setTokenState(data.token)
    setUser(data.user)
  }

  async function logout(): Promise<void> {
    await clearToken()
    setTokenState(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be called inside AuthProvider')
  return ctx
}
