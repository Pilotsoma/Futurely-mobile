import { randomUUID } from 'crypto'

// Keep Map TTL just under HAC's real session lifetime (~60 min).
// This ensures stale sessions are evicted and resolveSession re-logs in automatically.
const TTL_MS = 50 * 60 * 1000 // 50 minutes

export type SchoolSystemType = 'HAC' | 'PowerSchool'

export interface StoredSession {
  sessionData: string // Serialized cookie jar JSON
  systemType: SchoolSystemType
  baseUrl: string
  userId: number
  createdAt: number
  expiresAt: number
}

const store = new Map<string, StoredSession>()

// Purge expired sessions every 15 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of store.entries()) {
    if (val.expiresAt < now) store.delete(key)
  }
}, 15 * 60 * 1000).unref()

function normalizeBaseUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    return `${u.protocol}//${u.host}/`
  } catch {
    const m = url.trim().match(/^(https?:\/\/[^/?#]+)/)
    return m ? `${m[1]}/` : url
  }
}

export function saveSession(
  userId: number,
  systemType: SchoolSystemType,
  baseUrl: string,
  sessionData: string
): string {
  // One active session per user — overwrite any existing one
  for (const [key, val] of store.entries()) {
    if (val.userId === userId) store.delete(key)
  }
  const token = randomUUID()
  store.set(token, {
    sessionData,
    systemType,
    baseUrl: normalizeBaseUrl(baseUrl),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  })
  return token
}

export function getSessionByToken(token: string): StoredSession | null {
  const s = store.get(token)
  if (!s) return null
  if (s.expiresAt < Date.now()) {
    store.delete(token)
    return null
  }
  return s
}

export function getSessionByUserId(userId: number): { token: string; session: StoredSession } | null {
  for (const [token, s] of store.entries()) {
    if (s.userId === userId) {
      if (s.expiresAt < Date.now()) {
        store.delete(token)
        return null
      }
      return { token, session: s }
    }
  }
  return null
}

/**
 * No-op: HAC's own server-side session expires at ~60 min regardless of our
 * Map TTL. Extending the Map entry beyond 50 min just makes us think the
 * session is alive when HAC has already killed it, causing "session expired"
 * errors. Let the 50-min TTL expire naturally so resolveSession re-logs in.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function touchSession(_userId: number): void { /* intentionally empty */ }

export function deleteSessionByUserId(userId: number): void {
  for (const [key, val] of store.entries()) {
    if (val.userId === userId) store.delete(key)
  }
}

/**
 * Save a session to the in-memory store AND optionally persist to DB.
 */
export async function saveSessionWithPersistence(
  userId: number,
  systemType: SchoolSystemType,
  baseUrl: string,
  sessionData: string,
  prismaUpdate: (token: string, sessionData: string) => Promise<void>
): Promise<string> {
  const token = saveSession(userId, systemType, baseUrl, sessionData)
  try {
    await prismaUpdate(token, sessionData)
  } catch (e) {
    console.warn('[SESSION STORE] Failed to persist session to DB:',
      e instanceof Error ? e.message : String(e))
  }
  return token
}

/**
 * Restore a session into the in-memory store from a cached serialized cookie jar.
 * Returns the new session token, or null if cache is invalid.
 */
export function restoreSessionFromCache(
  userId: number,
  systemType: SchoolSystemType,
  baseUrl: string,
  cachedSessionData: string
): string | null {
  try {
    JSON.parse(cachedSessionData)
    return saveSession(userId, systemType, baseUrl, cachedSessionData)
  } catch {
    return null
  }
}

// ── DB session timestamp helpers ──────────────────────────────────────────────
// The cachedSession field stores a timestamped wrapper so we know whether the
// cookies are still fresh enough for HAC to accept them.
const CACHED_SESSION_MAX_AGE_MS = 50 * 60 * 1000 // must match TTL_MS above

export function wrapCachedSession(sessionData: string): string {
  return JSON.stringify({ savedAt: Date.now(), data: sessionData })
}

/**
 * Returns the raw cookie jar data + savedAt timestamp, or null if the wrapper
 * is invalid or the cookies are older than 50 minutes (HAC will have expired them).
 */
export function unwrapCachedSession(dbValue: string): { data: string; savedAt: number } | null {
  try {
    const parsed = JSON.parse(dbValue)
    if (typeof parsed.savedAt === 'number' && typeof parsed.data === 'string') {
      if (Date.now() - parsed.savedAt > CACHED_SESSION_MAX_AGE_MS) return null // stale
      return parsed
    }
    // Legacy format (raw cookie jar, no timestamp) — treat as stale
    return null
  } catch {
    return null
  }
}
import { safeConsole as console } from '../../common/safeConsole'
