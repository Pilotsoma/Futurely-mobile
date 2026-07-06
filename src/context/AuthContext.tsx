// AuthContext — auth and session state for the mobile app.
//
// Auth model (verified against backend/src/routes/auth.ts and middleware/auth.ts):
//
//   Futurely account layer:
//     - POST /api/auth/login (email + password) → { token, refreshToken, user }
//     - Access token: JWT, 15 min expiry. Sent as Bearer header on each request.
//     - Refresh token: 7-day rotating opaque token. Sent in request body from
//       mobile (backend reads req.body.refreshToken, no cookies on RN).
//     - GET /api/auth/me → validates stored token, returns current user.
//
//   School portal layer (separate step, performed after Futurely login):
//     - POST /api/integrations/grades/hac/login or /api/integrations/grades/powerschool/login
//     - Password is sent once and never stored on-device; backend encrypts it.
//     - GET /api/integrations/grades/status → { connected: boolean, ... }
//       Called right after auth resolves. hasPortalConnection reflects this.
//
// Session persistence:
//   - Only accessToken + refreshToken are persisted in AsyncStorage (see storage.ts).
//   - On app launch, tokens are loaded and /auth/me is called to validate the
//     session. If valid, portal status is immediately checked. The user sees
//     ConnectSchool if no portal is linked, or the main app if one exists.
//   - If /auth/me 401s, tryRefresh() is attempted before forcing re-login.
//   - This guarantees no forced logout on idle within the 7-day refresh window.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { type AuthUser, login, logout, getMe, refreshTokens } from '../api/authApi'
import { portalStatus } from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import { storeTokens, loadTokens, clearTokens } from '../utils/storage'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuthStatus =
  | 'initializing'   // App launch: checking stored tokens
  | 'unauthenticated' // No valid session
  | 'authenticated'  // Valid Futurely account session

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  /** Opaque access token; pass this to API calls that need auth. */
  accessToken: string | null
  /**
   * Whether the user has a linked school portal.
   * - null  → still checking (portal status call in flight)
   * - false → authenticated but no school portal linked → show ConnectSchool
   * - true  → authenticated and portal linked → show MainNavigator
   */
  hasPortalConnection: boolean | null
  /**
   * Sign in with Futurely email+password.
   * Throws ApiRequestError on invalid credentials, account lock, etc.
   * After sign-in, triggers a portal status check — hasPortalConnection is set.
   */
  signIn: (email: string, password: string) => Promise<void>
  /**
   * Clear the stored session and revoke the refresh token server-side.
   * Safe to call even if offline — local tokens are cleared regardless.
   */
  signOut: () => Promise<void>
  /**
   * Attempt a silent refresh using the stored refresh token.
   * Called internally on launch; also available to API callers that receive 401.
   * Returns true if the refresh succeeded, false if the session is dead.
   */
  tryRefresh: () => Promise<boolean>
  /**
   * Called by ConnectSchoolScreen after a successful portal connection.
   * Marks hasPortalConnection=true so RootNavigator advances to MainNavigator.
   */
  markPortalConnected: () => void
  /**
   * Called by Settings after disconnecting the school portal (or to trigger
   * a reconnect). Marks hasPortalConnection=false so RootNavigator swaps back
   * to ConnectSchoolNavigator without needing a full sign-out.
   */
  markPortalDisconnected: () => void
}

// ── Context ────────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ── Provider ───────────────────────────────────────────────────────────────────

export function AuthProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [status, setStatus]                       = useState<AuthStatus>('initializing')
  const [user, setUser]                           = useState<AuthUser | null>(null)
  const [accessToken, setAccessToken]             = useState<string | null>(null)
  const [refreshToken, setRefreshToken]           = useState<string | null>(null)
  const [hasPortalConnection, setHasPortalConnection] = useState<boolean | null>(null)

  // ── Helpers ────────────────────────────────────────────────────────────────

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setRefreshToken(null)
    setUser(null)
    setHasPortalConnection(null)
    setStatus('unauthenticated')
  }, [])

  // Fetch portal status and store result. Non-fatal — if the request fails,
  // hasPortalConnection stays null (treated the same as false in RootNavigator).
  const checkPortalStatus = useCallback(async (token: string): Promise<void> => {
    try {
      const s = await portalStatus(token)
      setHasPortalConnection(s.connected)
    } catch {
      // Could not check portal status — treat as "not connected" so ConnectSchool
      // is shown rather than MainNavigator. The user can reconnect there.
      setHasPortalConnection(false)
    }
  }, [])

  const applySession = useCallback(
    async (newAccessToken: string, newRefreshToken: string, authUser: AuthUser): Promise<void> => {
      setAccessToken(newAccessToken)
      setRefreshToken(newRefreshToken)
      setUser(authUser)
      // Set status to authenticated first, then check portal status.
      // hasPortalConnection starts as null during the check — RootNavigator
      // treats null as "still loading" and shows a loading indicator.
      setStatus('authenticated')
      await checkPortalStatus(newAccessToken)
    },
    [checkPortalStatus],
  )

  // ── tryRefresh ─────────────────────────────────────────────────────────────

  const tryRefresh = useCallback(async (): Promise<boolean> => {
    const { refreshToken: storedRefresh } = await loadTokens()
    if (!storedRefresh) return false

    try {
      const { token: newAccess, refreshToken: newRefresh } = await refreshTokens(storedRefresh)
      await storeTokens(newAccess, newRefresh)
      setAccessToken(newAccess)
      setRefreshToken(newRefresh)

      // Re-validate user after refresh
      const authUser = await getMe(newAccess)
      setUser(authUser)
      setStatus('authenticated')
      await checkPortalStatus(newAccess)
      return true
    } catch {
      await clearTokens()
      clearSession()
      return false
    }
  }, [clearSession, checkPortalStatus])

  // ── App launch: restore session from AsyncStorage ──────────────────────────

  useEffect(() => {
    let cancelled = false

    async function restoreSession(): Promise<void> {
      const { accessToken: storedAccess, refreshToken: storedRefresh } = await loadTokens()

      if (!storedAccess || !storedRefresh) {
        if (!cancelled) clearSession()
        return
      }

      // Fast path: validate the stored access token with /auth/me.
      try {
        const authUser = await getMe(storedAccess)
        if (!cancelled) {
          setAccessToken(storedAccess)
          setRefreshToken(storedRefresh)
          setUser(authUser)
          setStatus('authenticated')
          // Check portal status — null → false/true transition triggers navigator update.
          void checkPortalStatus(storedAccess)
        }
        return
      } catch (err: unknown) {
        // Only attempt refresh on 401 — other errors (network down, etc.) should
        // not destroy the session; the user is likely offline.
        const isUnauthorized =
          err instanceof ApiRequestError && err.status === 401

        if (!isUnauthorized) {
          // Could not validate but network may be down — keep stored tokens and
          // mark authenticated optimistically, mark portal unknown (null → false).
          if (!cancelled) {
            setAccessToken(storedAccess)
            setRefreshToken(storedRefresh)
            setHasPortalConnection(false)
            setStatus('authenticated')
          }
          return
        }
      }

      // Access token is expired — try refresh before forcing re-login.
      if (!cancelled) {
        const refreshed = await tryRefresh()
        if (!cancelled && !refreshed) clearSession()
      }
    }

    restoreSession().catch(() => {
      if (!cancelled) clearSession()
    })

    return () => { cancelled = true }
  }, [clearSession, tryRefresh, checkPortalStatus])

  // ── signIn ─────────────────────────────────────────────────────────────────

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const { token, refreshToken: newRefresh, user: authUser } = await login(email, password)
      await storeTokens(token, newRefresh)
      await applySession(token, newRefresh, authUser)
    },
    [applySession],
  )

  // ── signOut ────────────────────────────────────────────────────────────────

  const signOut = useCallback(async (): Promise<void> => {
    // Attempt server-side revocation — non-fatal if it fails (e.g. offline).
    if (accessToken && refreshToken) {
      try {
        await logout(accessToken, refreshToken)
      } catch {
        // Silent — local session is cleared regardless.
      }
    }
    await clearTokens()
    clearSession()
  }, [accessToken, refreshToken, clearSession])

  // ── markPortalConnected ────────────────────────────────────────────────────

  const markPortalConnected = useCallback((): void => {
    setHasPortalConnection(true)
  }, [])

  const markPortalDisconnected = useCallback((): void => {
    setHasPortalConnection(false)
  }, [])

  // ── Context value ──────────────────────────────────────────────────────────

  const value: AuthContextValue = {
    status,
    user,
    accessToken,
    hasPortalConnection,
    signIn,
    signOut,
    tryRefresh,
    markPortalConnected,
    markPortalDisconnected,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }
  return ctx
}
