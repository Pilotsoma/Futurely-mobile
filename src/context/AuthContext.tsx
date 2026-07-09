import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as authApi from '../api/authApi'
import * as gradesApi from '../api/gradesApi'
import { clearTokens, loadTokens } from '../utils/storage'
import type { AuthUser, LoginRequest, RegisterRequest } from '../types/auth'

type AuthStatus = 'initializing' | 'unauthenticated' | 'authenticated'

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  /** null while the portal-status check is in flight after authentication resolves. */
  hasPortalConnection: boolean | null
  signIn: (payload: LoginRequest) => Promise<void>
  register: (payload: RegisterRequest) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: (password?: string) => Promise<void>
  /** Called by ConnectSchoolScreen after a successful login+sync, to skip re-querying status. */
  markPortalConnected: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('initializing')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [hasPortalConnection, setHasPortalConnection] = useState<boolean | null>(null)

  const checkPortalStatus = useCallback(async () => {
    setHasPortalConnection(null)
    try {
      const status = await gradesApi.getPortalStatus()
      setHasPortalConnection(status.connected)
    } catch {
      // A failed status check is treated as "not connected" — worst case the user
      // re-lands on ConnectSchool and reconnects, rather than getting stuck loading.
      setHasPortalConnection(false)
    }
  }, [])

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
        void checkPortalStatus()
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
  }, [checkPortalStatus])

  const signIn = useCallback(
    async (payload: LoginRequest) => {
      const result = await authApi.login(payload)
      setUser(result.user)
      setStatus('authenticated')
      void checkPortalStatus()
    },
    [checkPortalStatus],
  )

  const register = useCallback(
    async (payload: RegisterRequest) => {
      // Apply the session directly from the tokens register() already stored —
      // no redundant extra getMe() round-trip (the deleted version did this).
      const result = await authApi.register(payload)
      setUser(result.user)
      setStatus('authenticated')
      void checkPortalStatus()
    },
    [checkPortalStatus],
  )

  const signInWithGoogle = useCallback(async () => {
    await authApi.signInWithGoogle()
    // The OAuth callback only returns tokens, not a user object (unlike login/register) — fetch it.
    const me = await authApi.getMe()
    setUser(me)
    setStatus('authenticated')
    void checkPortalStatus()
  }, [checkPortalStatus])

  const signOut = useCallback(async () => {
    await authApi.logout()
    setUser(null)
    setStatus('unauthenticated')
    setHasPortalConnection(null)
  }, [])

  const deleteAccount = useCallback(async (password?: string) => {
    await authApi.deleteAccount(password)
    setUser(null)
    setStatus('unauthenticated')
    setHasPortalConnection(null)
  }, [])

  const markPortalConnected = useCallback(() => {
    setHasPortalConnection(true)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      hasPortalConnection,
      signIn,
      register,
      signInWithGoogle,
      signOut,
      deleteAccount,
      markPortalConnected,
    }),
    [
      status,
      user,
      hasPortalConnection,
      signIn,
      register,
      signInWithGoogle,
      signOut,
      deleteAccount,
      markPortalConnected,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
