import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DeviceEventEmitter } from 'react-native'
import * as authApi from '../api/authApi'
import * as gradesApi from '../api/gradesApi'
import {
  ACCOUNT_STATUS_CHANGED_EVENT,
  SESSION_EXPIRED_EVENT,
} from '../api/client'
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
  signInWithGoogle: (intent: 'login' | 'signup') => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: (password?: string) => Promise<void>
  updateDateOfBirth: (dateOfBirth: string) => Promise<void>
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

  const refreshUser = useCallback(async () => {
    const me = await authApi.getMe()
    setUser(me)
    if (me.accountStatus === 'ACTIVE') {
      await checkPortalStatus()
    } else {
      setHasPortalConnection(null)
    }
  }, [checkPortalStatus])

  useEffect(() => {
    let cancelled = false

    async function restoreSession(): Promise<void> {
      try {
        const stored = await loadTokens()
        if (!stored) {
          if (!cancelled) setStatus('unauthenticated')
          return
        }
        // authApi.getMe() already goes through client.request()'s 401-refresh-retry —
        // if it still throws, the session is genuinely gone, not just expired.
        const me = await authApi.getMe()
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
        if (me.accountStatus === 'ACTIVE') {
          void checkPortalStatus()
        }
      } catch {
        // Covers both a dead/expired session and a storage-layer read failure —
        // either way there's no usable session, so fail safe to the login screen
        // instead of leaving `status` stuck at 'initializing' forever.
        if (cancelled) return
        await clearTokens().catch(() => undefined)
        setStatus('unauthenticated')
      }
    }

    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [checkPortalStatus])

  // client.ts emits this when a mid-session token refresh fails (tokens already
  // cleared there) — without this, every screen's own error handler just shows a
  // generic "could not load" message with no path back to Login.
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(SESSION_EXPIRED_EVENT, () => {
      setUser(null)
      setStatus('unauthenticated')
      setHasPortalConnection(null)
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      ACCOUNT_STATUS_CHANGED_EVENT,
      () => {
        void refreshUser().catch(() => undefined)
      },
    )
    return () => subscription.remove()
  }, [refreshUser])

  const signIn = useCallback(
    async (payload: LoginRequest) => {
      const result = await authApi.login(payload)
      setUser(result.user)
      setStatus('authenticated')
      if (result.user.accountStatus === 'ACTIVE') {
        void checkPortalStatus()
      }
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
      if (result.user.accountStatus === 'ACTIVE') {
        void checkPortalStatus()
      }
    },
    [checkPortalStatus],
  )

  const signInWithGoogle = useCallback(async (intent: 'login' | 'signup') => {
    await authApi.signInWithGoogle(intent)
    // The OAuth callback only returns tokens, not a user object (unlike login/register) — fetch it.
    const me = await authApi.getMe()
    setUser(me)
    setStatus('authenticated')
    if (me.accountStatus === 'ACTIVE') {
      void checkPortalStatus()
    }
  }, [checkPortalStatus])

  const updateDateOfBirth = useCallback(
    async (dateOfBirth: string) => {
      await authApi.updateDateOfBirth(dateOfBirth)
      await refreshUser()
    },
    [refreshUser],
  )

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
      updateDateOfBirth,
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
      updateDateOfBirth,
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
