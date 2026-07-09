import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as authApi from '../api/authApi'
import { clearTokens, loadTokens } from '../utils/storage'
import type { AuthUser, LoginRequest, RegisterRequest } from '../types/auth'

type AuthStatus = 'initializing' | 'unauthenticated' | 'authenticated'

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  signIn: (payload: LoginRequest) => Promise<void>
  register: (payload: RegisterRequest) => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: (password?: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('initializing')
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let cancelled = false

    async function restoreSession(): Promise<void> {
      const stored = await loadTokens()
      if (!stored) {
        if (!cancelled) setStatus('unauthenticated')
        return
      }
      try {
        // authApi.getMe() already goes through client.request()'s 401-refresh-retry —
        // if it still throws, the session is genuinely gone, not just expired.
        const me = await authApi.getMe()
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
      } catch {
        if (cancelled) return
        await clearTokens()
        setStatus('unauthenticated')
      }
    }

    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (payload: LoginRequest) => {
    const result = await authApi.login(payload)
    setUser(result.user)
    setStatus('authenticated')
  }, [])

  const register = useCallback(async (payload: RegisterRequest) => {
    // Apply the session directly from the tokens register() already stored —
    // no redundant extra getMe() round-trip (the deleted version did this).
    const result = await authApi.register(payload)
    setUser(result.user)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(async () => {
    await authApi.logout()
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const deleteAccount = useCallback(async (password?: string) => {
    await authApi.deleteAccount(password)
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, register, signOut, deleteAccount }),
    [status, user, signIn, register, signOut, deleteAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
