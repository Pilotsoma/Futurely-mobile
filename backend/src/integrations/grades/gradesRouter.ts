import { Router, Response, NextFunction, Request } from 'express'
import { z } from 'zod'
import { AuthRequest } from '../../middleware/auth'
import {
  loginHAC,
  getGrades as hacGrades,
  getTranscript as hacTranscript,
  getSchedule,
  getStudentInfo,
  getReportCard,
  getProgressReport,
  getContactTeachers,
  getAttendance,
} from './hacClient'
import {
  loginPowerSchool,
  getGrades as psGrades,
  getTranscript as psTranscript,
} from './powerSchoolClient'
import { buildSessionWithCLCookie } from './classLinkHelper'
import { getSessionByUserId, getSessionByToken, deleteSessionByUserId, restoreSessionFromCache, touchSession, wrapCachedSession, unwrapCachedSession, type SchoolSystemType } from './sessionStore'
import { prisma } from '../../lib/prisma'
import { writeAuditLog } from '../../lib/auditLog'
import { APIError, AuthenticationError } from './errors'
import { normalizeHacGrades, normalizePsGrades } from './normalizeGrades'
import { encryptPassword, decryptPassword } from './credentialCrypto'
import { assertPublicHttpUrl } from '../../lib/ssrfGuard'
import { parseHacDate, encryptDob, evaluateDobVerification } from '../../lib/dobVerification'
import { AccountStatus } from '@prisma/client'
import { logger } from '../../common/logger'

const router = Router()

// ── URL normalizer (mirrors extractOrigin in hacClient) ───────────────────────
// Ensures the baseUrl stored in the session always ends with a trailing slash
// so that all scraping functions can safely do `${origin}HomeAccess/...`.
// Without this, a stored URL like "https://homeaccess.katyisd.org" (no slash)
// produces "https://homeaccess.katyisd.orghomeaccess/..." → ENOTFOUND.
function toOrigin(url: string): string {
  try {
    const u = new URL(url.trim())
    return `${u.protocol}//${u.host}/`
  } catch {
    const m = url.trim().match(/^(https?:\/\/[^/?#]+)/)
    return m ? `${m[1]}/` : url
  }
}

// ── Input schemas ──────────────────────────────────────────────────────────────

const hacLoginSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  username: z.string().min(1, 'username required'),
  password: z.string().min(1, 'password required'),
  clsessionCookie: z.string().optional(),
})

const psLoginSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  username: z.string().min(1, 'username required'),
  password: z.string().min(1, 'password required'),
})

// ── GPA calculator ─────────────────────────────────────────────────────────────

const GRADE_POINTS: Record<string, number> = {
  'A+': 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  'D-': 0.7,
  F: 0.0,
}

function letterToGPA(letter: string): number | null {
  return GRADE_POINTS[letter.trim()] ?? null
}

function computeGPA(grades: Array<{ average: string | null; grade?: string | null }>): number | null {
  const points: number[] = []

  for (const g of grades) {
    const raw = g.average ?? g.grade ?? null
    if (!raw) continue

    const letter = raw.trim().toUpperCase()
    const p = letterToGPA(letter)

    if (p !== null) {
      points.push(p)
      continue
    }

    const num = parseFloat(raw)

    if (!Number.isNaN(num)) {
      if (num >= 90) points.push(4.0)
      else if (num >= 80) points.push(3.0)
      else if (num >= 70) points.push(2.0)
      else if (num >= 60) points.push(1.0)
      else points.push(0.0)
    }
  }

  if (!points.length) return null

  return Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 1000) / 1000
}

// ── Error helpers ──────────────────────────────────────────────────────────────

function getErrorDetails(err: unknown): {
  message: string
  code?: string
  status?: number
  responseData?: unknown
  stack?: string
} {
  const anyErr = err as {
    message?: string
    code?: string
    stack?: string
    response?: {
      status?: number
      data?: unknown
    }
  }

  return {
    message: anyErr?.message ?? 'Unknown error',
    code: anyErr?.code,
    status: anyErr?.response?.status,
    responseData: anyErr?.response?.data,
    stack: anyErr?.stack,
  }
}

function statusFromError(message: string, status?: number): number {
  if (status && status >= 400 && status < 600) return status
  if (message.toLowerCase().includes('invalid credentials')) return 401
  if (message.toLowerCase().includes('password')) return 401
  if (message.toLowerCase().includes('timeout')) return 504
  if (message.toLowerCase().includes('reach')) return 502
  if (message.toLowerCase().includes('network')) return 502
  return 500
}

function sendError(res: Response, label: string, err: unknown, fallbackCode: string): void {
  const details = getErrorDetails(err)
  const status = err instanceof APIError ? err.status : statusFromError(details.message, details.status)

  // Full details logged server-side only — never sent to client.
  console.error(`[${label}] FAILED`, {
    message: details.message,
    code: details.code,
    status: details.status,
    responseData: details.responseData,
    stack: details.stack,
  })

  // Client-facing message: safe, categorised, no internal detail.
  const isFeatureDisabled = details.message.toLowerCase().includes('not enabled') ||
    details.message.toLowerCase().includes('option not enabled')

  const clientMessage =
    err instanceof AuthenticationError
      ? 'Invalid credentials. Please check your username and password.'
      : isFeatureDisabled
      ? 'This feature is not available for your school account. Your district may have disabled individual assignment grades in the student portal.'
      : status === 504
      ? 'The school portal did not respond in time. Please try again later.'
      : status === 502
      ? 'Could not reach the school portal. Please try again later.'
      : 'An error occurred. Please try again.'

  const clientCode = err instanceof AuthenticationError
    ? 'AUTH_ERROR'
    : isFeatureDisabled
    ? 'FEATURE_NOT_ENABLED'
    : fallbackCode

  res.status(status).json({
    data: null,
    error: {
      code: clientCode,
      message: clientMessage,
    },
  })
}

// asyncHandler: ensures uncaught async errors always produce JSON + correct CORS headers.
// Login/session pattern adapted from gradexis-api (Apache-2.0): github.com/ruskcoder/gradexis-api
function asyncHandler(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthRequest, res, next)).catch(err => {
      console.error('[GRADES ROUTER] Unhandled route error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      if (!res.headersSent) {
        const status = err instanceof APIError ? err.status : 500
        res.status(status).json({
          data: null,
          error: {
            code: err instanceof AuthenticationError ? 'AUTH_ERROR' : 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
        })
      }
    })
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function requireSession(userId: number, res: Response): ReturnType<typeof getSessionByUserId> {
  const entry = getSessionByUserId(userId)

  if (!entry) {
    res.status(401).json({
      data: null,
      error: {
        code: 'NO_SCHOOL_SESSION',
        message: 'No active school session. Please log in to your school portal first.',
      },
    })

    return null
  }

  return entry
}

// ── Auto-relogin using stored credentials ─────────────────────────────────────
// When the HAC/PS session expires (~60 min), silently re-login using the
// encrypted credentials stored in SchoolConnection so the user never has
// to re-enter their portal password.

async function autoRelogin(userId: number): Promise<{ token: string; session: ReturnType<typeof getSessionByUserId> } | null> {
  const connection = await prisma.schoolConnection.findUnique({ where: { userId } }).catch(() => null)
  if (!connection) return null

  // Determine which credentials to use
  const isHAC = connection.systemType === 'HAC'
  const username = connection.hacUsername
  const encryptedPassword = connection.encryptedPassword

  if (!username || !encryptedPassword) {
    console.log('[GRADES ROUTER] No stored credentials for auto-relogin, userId:', userId)
    return null
  }

  let password: string
  try {
    password = decryptPassword(encryptedPassword)
  } catch (e) {
    console.warn('[GRADES ROUTER] Failed to decrypt stored password:', e instanceof Error ? e.message : String(e))
    return null
  }

  console.log('[GRADES ROUTER] Attempting auto-relogin for userId:', userId, 'system:', connection.systemType)

  try {
    const origin = toOrigin(connection.districtUrl)
    let sessionToken: string

    if (isHAC) {
      sessionToken = await loginHAC(origin, username, password, userId)
    } else {
      sessionToken = await loginPowerSchool(origin, username, password, userId)
    }

    // Persist the fresh session cookie to DB
    const stored = getSessionByToken(sessionToken)
    if (stored) {
      await prisma.schoolConnection.update({
        where: { userId },
        data: { cachedSession: wrapCachedSession(stored.sessionData), lastSynced: new Date() },
      }).catch(e => console.warn('[GRADES ROUTER] Non-fatal: failed to persist relogin session:', e instanceof Error ? e.message : String(e)))
    }

    console.log('[GRADES ROUTER] Auto-relogin successful for userId:', userId)
    const entry = getSessionByUserId(userId)
    return { token: sessionToken, session: entry }
  } catch (e) {
    console.warn('[GRADES ROUTER] Auto-relogin failed for userId:', userId, ':', e instanceof Error ? e.message : String(e))
    return null
  }
}

// ── Session resolution with DB fallback + auto-relogin ───────────────────────
// Priority: in-memory session → auto-relogin → DB cache restore → error
// When the in-memory session is gone (backend restart or expired), we try
// auto-relogin first because the DB-cached cookie jar is almost certainly
// expired on HAC's side (~60 min TTL). Only if relogin fails do we fall
// back to restoring the cached cookie as a last resort.

async function resolveSession(userId: number, res: Response): Promise<ReturnType<typeof getSessionByUserId>> {
  // 1. Fast path: in-memory session is still valid
  let entry = getSessionByUserId(userId)
  if (entry) return entry

  // 2. No in-memory session → try auto-relogin with stored credentials
  const reloginResult = await autoRelogin(userId)
  if (reloginResult?.session) {
    entry = reloginResult.session
    if (entry) return entry
  }

  // 3. Auto-relogin failed → last resort: restore from DB cache only if fresh
  // (cookies older than 50 min are dead on HAC's side — restoring them just
  // puts a stale entry in memory that fails on the very next HAC request)
  const connection = await prisma.schoolConnection.findUnique({ where: { userId } }).catch(() => null)
  if (connection?.cachedSession) {
    const unwrapped = unwrapCachedSession(connection.cachedSession)
    if (unwrapped) {
      console.log('[GRADES ROUTER] Last resort: restoring fresh DB-cached session for userId:', userId)
      const restoredToken = restoreSessionFromCache(
        userId,
        connection.systemType as SchoolSystemType,
        toOrigin(connection.districtUrl),
        unwrapped.data,
      )
      if (restoredToken) entry = getSessionByUserId(userId)
    } else {
      console.log('[GRADES ROUTER] DB-cached session is stale — skipping restore for userId:', userId)
    }
  }

  if (!entry) {
    res.status(401).json({
      data: null,
      error: {
        code: 'NO_SCHOOL_SESSION',
        message: 'No active school session. Please log in to your school portal first.',
      },
    })
    return null
  }

  return entry
}

// ── Staleness threshold ────────────────────────────────────────────────────────
const SYNC_STALE_MS = 15 * 60 * 1000 // 15 minutes

function isCacheStale(lastSynced: Date | null): boolean {
  if (!lastSynced) return true
  return Date.now() - lastSynced.getTime() > SYNC_STALE_MS
}

// ── Per-endpoint HAC response cache ───────────────────────────────────────────
// Stored as JSON in SchoolConnection.hacDataCache keyed by endpoint name.
// Cache misses fall through to live HAC scraping — identical to pre-cache behavior.
const HAC_CACHE_TTL_MS: Record<string, number> = {
  transcript:     24 * 60 * 60 * 1000,  // 24h  — rarely changes
  schedule:        7 * 24 * 60 * 60 * 1000,  // 7d   — changes once per semester
  gpa:             4 * 60 * 60 * 1000,  // 4h
  contactTeachers: 24 * 60 * 60 * 1000, // 24h
}
const CLASSWORK_TTL_MS   = 2 * 60 * 60 * 1000  // 2h  — grades update throughout the day
const REPORT_CARD_TTL_MS = 6 * 60 * 60 * 1000  // 6h
const ATTENDANCE_TTL_MS  = 4 * 60 * 60 * 1000  // 4h
const PROGRESS_TTL_MS    = 4 * 60 * 60 * 1000  // 4h

async function readHacCache(userId: number, key: string, ttlMs: number): Promise<unknown | null> {
  try {
    const conn = await prisma.schoolConnection.findUnique({ where: { userId }, select: { hacDataCache: true } })
    if (!conn?.hacDataCache) return null
    const cache = conn.hacDataCache as Record<string, { data: unknown; cachedAt: number }>
    const entry = cache[key]
    if (!entry || Date.now() - entry.cachedAt > ttlMs) return null
    return entry.data
  } catch { return null }
}

async function writeHacCache(userId: number, key: string, data: unknown): Promise<void> {
  try {
    const conn = await prisma.schoolConnection.findUnique({ where: { userId }, select: { hacDataCache: true } })
    const existing: any = conn?.hacDataCache ?? {}
    await prisma.schoolConnection.update({
      where: { userId },
      data: { hacDataCache: { ...existing, [key]: { data, cachedAt: Date.now() } } as any },
    })
  } catch (e) {
    console.warn('[HAC CACHE] Non-fatal write failure:', e instanceof Error ? e.message : String(e))
  }
}

// ── Background grade sync ──────────────────────────────────────────────────────
// Fired without await after /hac/login responds. Updates syncStatus on
// SchoolConnection so the client can poll GET /sync-status.
async function runBackgroundSync(userId: number, sessionToken: string): Promise<void> {
  console.log('[GRADES ROUTER] Background sync starting for userId:', userId)

  // Persist session cookie immediately so restart-recovery works even if sync fails
  try {
    const stored = getSessionByToken(sessionToken)
    if (stored) {
      await prisma.schoolConnection.update({
        where: { userId },
        data: { cachedSession: wrapCachedSession(stored.sessionData) },
      })
    }
  } catch (e) {
    console.warn('[GRADES ROUTER] Background sync: could not persist session:', e instanceof Error ? e.message : String(e))
  }

  // Staleness check — skip re-scrape if data is fresh
  const connection = await prisma.schoolConnection.findUnique({ where: { userId } }).catch(() => null)
  if (connection && !isCacheStale(connection.lastSynced)) {
    console.log('[GRADES ROUTER] Background sync skipped — data fresh, last synced:', connection.lastSynced)
    await prisma.schoolConnection.update({ where: { userId }, data: { syncStatus: 'complete' } }).catch(() => {})
    return
  }

  // Mark sync in progress
  await prisma.schoolConnection.update({
    where: { userId },
    data: { syncStatus: 'syncing', syncError: null },
  }).catch(() => {})

  try {
    const entry = getSessionByUserId(userId)
    if (!entry) throw new Error('Session expired before sync could run')

    if (entry.session.systemType === 'HAC') {
      // Sync student info into User + Profile
      try {
        const studentInfo = await getStudentInfo(sessionToken)
        if (studentInfo.name?.trim()) {
          // Write to hacName — never overwrite the user's chosen display name
          await prisma.user.update({ where: { id: userId }, data: { hacName: studentInfo.name.trim() } })
          console.log('[GRADES ROUTER] Background sync: updated hacName for userId:', userId)
        }
        const profileUpdate: Record<string, unknown> = {}
        if (studentInfo.counselor?.trim()) profileUpdate.counselorName = studentInfo.counselor.trim()
        const cohortNum = studentInfo.cohortYear ? parseInt(studentInfo.cohortYear.replace(/\D/g, ''), 10) : NaN
        if (!isNaN(cohortNum) && cohortNum > 2000 && cohortNum < 2060) {
          profileUpdate.graduationYear = cohortNum
          const now = new Date()
          const effectiveYear = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()
          const derived = 12 - (cohortNum - effectiveYear)
          if (derived >= 9 && derived <= 12) profileUpdate.gradeLevel = derived
        }
        if (Object.keys(profileUpdate).length > 0) {
          await prisma.profile.upsert({ where: { userId }, create: { userId, ...profileUpdate }, update: profileUpdate })
        }

        // DOB verification — compare HAC-reported DOB against self-reported DOB.
        // Non-fatal: a failure here must never abort the grade sync.
        if (studentInfo.dateOfBirth) {
          const parsedDob = parseHacDate(studentInfo.dateOfBirth)
          if (parsedDob) {
            try {
              const hacDobEncrypted = encryptDob(parsedDob)
              const user = await prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } })
              if (user) {
                const evaluation = user.dateOfBirth
                  ? evaluateDobVerification({ selfReportedDobEncrypted: user.dateOfBirth, hacDobEncrypted })
                  : { status: AccountStatus.DOB_MISMATCH_LOCKED, ageYears: null, bannedUntilDate: null }
                const auditAction = evaluation.status === AccountStatus.ACTIVE
                  ? 'DOB_MATCH_VERIFIED'
                  : evaluation.status === AccountStatus.UNDER_13_BANNED
                    ? 'UNDER_13_BANNED'
                    : 'DOB_MISMATCH_LOCKED'
                await prisma.$transaction([
                  prisma.user.update({
                    where: { id: userId },
                    data: {
                      hacDateOfBirth: hacDobEncrypted,
                      accountStatus: evaluation.status,
                      bannedUntilDate: evaluation.bannedUntilDate,
                    },
                  }),
                  prisma.complianceAuditLog.create({
                    data: { userId, resourceType: 'user_identity', resourceId: String(userId), action: 'HAC_DOB_SYNCED', ipAddress: 'background-sync' },
                  }),
                  prisma.complianceAuditLog.create({
                    data: { userId, resourceType: 'user_identity', resourceId: String(userId), action: auditAction, ipAddress: 'background-sync' },
                  }),
                ])
              }
            } catch (dobErr) {
              logger.error('grades.dobVerification.failed', { userId, error: dobErr instanceof Error ? dobErr.message : String(dobErr) })
              // Non-fatal — DOB comparison failure must not abort the grade sync.
            }
          }
        }
      } catch (infoErr) {
        console.warn('[GRADES ROUTER] Background sync: student info fetch failed (non-fatal):',
          infoErr instanceof Error ? infoErr.message : String(infoErr))
      }

      // Fetch HAC grades to seed the classwork cache (non-fatal — some districts or account
      // types have Classes/Classwork disabled; in that case skip the cache write and let the
      // other endpoints (transcript, schedule, etc.) still populate so the sync is not a total
      // failure). The on-demand /classwork route will surface a clear error to the client.
      try {
        const { classes: rawHacGrades, availablePeriods: hacAvailablePeriods, currentPeriod: hacCurrentPeriod } = await hacGrades(entry.token)
        void writeHacCache(userId, 'classwork:__default__', { classes: rawHacGrades, availablePeriods: hacAvailablePeriods, currentPeriod: hacCurrentPeriod })
      } catch (cwErr) {
        console.warn('[GRADES ROUTER] Background sync: classwork fetch failed (non-fatal):',
          cwErr instanceof Error ? cwErr.message : String(cwErr))
      }

      // Pre-warm the remaining slow endpoints in parallel — fire and forget, non-fatal
      // By the time the user navigates to these pages the cache will already be populated
      void Promise.allSettled([
        hacTranscript(entry.token).then(t => writeHacCache(userId, 'transcript', t)),
        getSchedule(entry.token).then(s => writeHacCache(userId, 'schedule', s)),
        getAttendance(entry.token, 0).then(a => writeHacCache(userId, 'attendance:0', a)),
        getContactTeachers(entry.token).then(c => writeHacCache(userId, 'contactTeachers', c)),
      ]).then(results => {
        const ok = results.filter(r => r.status === 'fulfilled').length
        console.log(`[GRADES ROUTER] Cache pre-warm: ${ok}/${results.length} endpoints cached for userId:`, userId)
      })
    }

    await prisma.schoolConnection.update({
      where: { userId },
      data: { syncStatus: 'complete', syncError: null, lastSynced: new Date(), consecutiveSyncFailures: 0 },
    }).catch(() => {})
    console.log('[GRADES ROUTER] Background sync complete for userId:', userId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[GRADES ROUTER] Background sync failed for userId:', userId, ':', msg, err instanceof Error ? err.stack : '')
    // Store a safe category code — never raw exception text — because syncError
    // is returned to the client via GET /sync-status.
    const syncErrCode =
      err instanceof AuthenticationError
        ? 'AUTH_FAILED'
        : msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('reach') || msg.toLowerCase().includes('network')
        ? 'UNREACHABLE'
        : 'SYNC_FAILED'
    await prisma.schoolConnection.update({
      where: { userId },
      data: {
        syncStatus: 'error',
        syncError: syncErrCode,
        // Increment regardless of error type — any repeated failure is worth tracking.
        // The portalDown flag (derived in GET /sync-status) only fires for UNREACHABLE
        // so students are not alarmed about auth errors they can fix themselves.
        consecutiveSyncFailures: { increment: 1 },
      },
    }).catch(() => {})
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

router.post('/hac/login', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  console.log('[GRADES ROUTER] HAC login route hit')

  const parse = hacLoginSchema.safeParse(req.body)

  if (!parse.success) {
    console.log('[GRADES ROUTER] HAC validation failed:', parse.error.errors)

    res.status(400).json({
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: parse.error.errors[0]?.message ?? 'Invalid request',
      },
    })

    return
  }

  const { baseUrl, username, password, clsessionCookie } = parse.data
  const userId = req.userId!

  console.log('[GRADES ROUTER] HAC login parsed:', {
    userId,
    baseUrl,
    usernameExists: Boolean(username),
    passwordExists: Boolean(password),
    hasClSessionCookie: Boolean(clsessionCookie),
  })

  try {
    let resolvedBaseUrl = baseUrl

    if (clsessionCookie) {
      const cl = buildSessionWithCLCookie(clsessionCookie, baseUrl)
      resolvedBaseUrl = cl.districtUrl
    }

    // SSRF guard: baseUrl (and any URL derived from the ClassLink cookie) is
    // fully attacker-controlled — reject anything that isn't a public http(s) host
    // before the server makes an outbound request to it.
    try {
      await assertPublicHttpUrl(resolvedBaseUrl)
    } catch (e) {
      res.status(400).json({
        data: null,
        error: { code: 'VALIDATION_ERROR', message: e instanceof Error ? e.message : 'Invalid baseUrl' },
      })
      return
    }

    console.log('[GRADES ROUTER] Calling loginHAC:', {
      resolvedBaseUrl,
      userId,
    })

    const sessionToken = await loginHAC(
      resolvedBaseUrl,
      username,
      password,
      userId,
      clsessionCookie,
    )

    console.log('[GRADES ROUTER] loginHAC success:', {
      hasSessionToken: Boolean(sessionToken),
    })

    // Block if another account already owns this school username
    const taken = await prisma.schoolConnection.findFirst({
      where: {
        systemType: 'HAC',
        districtUrl: resolvedBaseUrl,
        hacUsername: username,
        NOT: { userId },
      },
    })
    if (taken) {
      res.status(409).json({
        data: null,
        error: {
          code: 'SCHOOL_ACCOUNT_TAKEN',
          message: 'This school account is already linked to another Futurely account. Each school ID can only be used once.',
        },
      })
      return
    }

    // Encrypt and store the HAC password for auto-relogin when sessions expire
    let encryptedPassword: string | null = null
    try {
      encryptedPassword = encryptPassword(password)
    } catch (e) {
      console.warn('[GRADES ROUTER] Non-fatal: could not encrypt HAC password:', e instanceof Error ? e.message : String(e))
    }

    await prisma.schoolConnection.upsert({
      where: { userId },
      update: {
        systemType: 'HAC',
        districtUrl: resolvedBaseUrl,
        hacUsername: username,
        ...(encryptedPassword ? { encryptedPassword: encryptedPassword } : {}),
        lastSynced: new Date(),
      },
      create: {
        userId,
        systemType: 'HAC',
        districtUrl: resolvedBaseUrl,
        hacUsername: username,
        ...(encryptedPassword ? { encryptedPassword: encryptedPassword } : {}),
      },
    })

    // Auto-assign developer role if recognized HAC username
    const DEV_USERNAMES = ['K2008105', 'K2308016']
    if (DEV_USERNAMES.includes(username.trim())) {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            role: 'ADMIN',
            tag: 'DEV',
            tagColor: 'lightblue',
          },
        })
        console.log('[GRADES ROUTER] Auto-assigned DEV role + tag for HAC user:', username)
      } catch (devErr) {
        console.warn('[GRADES ROUTER] Non-fatal: could not assign DEV role:', devErr instanceof Error ? devErr.message : String(devErr))
      }
    }

    // Respond immediately — all remaining work (session cache, student info, grade sync)
    // runs in the background so the client is not blocked by HAC scraping.
    res.json({
      data: {
        sessionToken,
        systemType: 'HAC',
        districtUrl: resolvedBaseUrl,
        expiresIn: 1800,
      },
    })

    // Fire-and-forget: persist session + sync grades in background
    runBackgroundSync(userId, sessionToken).catch(e =>
      console.error('[GRADES ROUTER] Unhandled background sync error:', e instanceof Error ? e.message : String(e))
    )
  } catch (err: unknown) {
    sendError(res, 'HAC_LOGIN', err, 'LOGIN_FAILED')
  }
}))

router.post('/powerschool/login', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  console.log('[GRADES ROUTER] PowerSchool login route hit')

  const parse = psLoginSchema.safeParse(req.body)

  if (!parse.success) {
    console.log('[GRADES ROUTER] PowerSchool validation failed:', parse.error.errors)

    res.status(400).json({
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: parse.error.errors[0]?.message ?? 'Invalid request',
      },
    })

    return
  }

  const { baseUrl, username, password } = parse.data
  const userId = req.userId!

  console.log('[GRADES ROUTER] PowerSchool login parsed:', {
    userId,
    baseUrl,
    usernameExists: Boolean(username),
    passwordExists: Boolean(password),
  })

  try {
    await assertPublicHttpUrl(baseUrl)
  } catch (e) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: e instanceof Error ? e.message : 'Invalid baseUrl' },
    })
    return
  }

  try {
    const sessionToken = await loginPowerSchool(baseUrl, username, password, userId)

    // Encrypt and store the PowerSchool password for auto-relogin when sessions expire
    let encryptedPsPassword: string | null = null
    try {
      encryptedPsPassword = encryptPassword(password)
    } catch (e) {
      console.warn('[GRADES ROUTER] Non-fatal: could not encrypt PS password:', e instanceof Error ? e.message : String(e))
    }

    await prisma.schoolConnection.upsert({
      where: { userId },
      update: {
        systemType: 'PowerSchool',
        districtUrl: baseUrl,
        ...(encryptedPsPassword ? { encryptedPassword: encryptedPsPassword } : {}),
        lastSynced: new Date(),
      },
      create: {
        userId,
        systemType: 'PowerSchool',
        districtUrl: baseUrl,
        ...(encryptedPsPassword ? { encryptedPassword: encryptedPsPassword } : {}),
      },
    })

    // Persist the session cookie to DB so it can survive backend restarts
    try {
      const stored = getSessionByToken(sessionToken)
      if (stored) {
        await prisma.schoolConnection.update({
          where: { userId },
          data: { cachedSession: wrapCachedSession(stored.sessionData) },
        })
        console.log('[GRADES ROUTER] PS session cached to DB for userId:', userId)
      }
    } catch (cacheErr) {
      console.warn('[GRADES ROUTER] Non-fatal: could not cache PS session:',
        cacheErr instanceof Error ? cacheErr.message : String(cacheErr))
    }

    res.json({
      data: {
        sessionToken,
        systemType: 'PowerSchool',
        districtUrl: baseUrl,
        expiresIn: 1800,
      },
    })
  } catch (err: unknown) {
    sendError(res, 'POWERSCHOOL_LOGIN', err, 'LOGIN_FAILED')
  }
}))

router.get('/current', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!
  const entry = await resolveSession(userId, res)
  if (!entry) return

  try {
    // Extend session on successful access
    touchSession(userId)

    if (entry.session.systemType === 'HAC') {
      const { classes: rawHacGrades } = await hacGrades(entry.token)
      const normalizedGrades = normalizeHacGrades(rawHacGrades)

      res.json({
        data: {
          systemType: entry.session.systemType,
          grades: normalizedGrades,
        },
      })
    } else {
      const rawPsGrades = await psGrades(entry.token)
      const normalizedGrades = normalizePsGrades(rawPsGrades)

      res.json({
        data: {
          systemType: entry.session.systemType,
          grades: normalizedGrades,
        },
      })
    }
  } catch (err: unknown) {
    sendError(res, 'FETCH_CURRENT_GRADES', err, 'FETCH_ERROR')
  }
}))

router.get('/transcript', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  try {
    const cached = await readHacCache(req.userId!, 'transcript', HAC_CACHE_TTL_MS.transcript)
    if (cached) {
      res.json({ data: { systemType: entry.session.systemType, transcript: cached } })
      return
    }

    let transcript: object
    if (entry.session.systemType === 'HAC') {
      transcript = await hacTranscript(entry.token)
    } else {
      transcript = await psTranscript(entry.token)
    }

    void writeHacCache(req.userId!, 'transcript', transcript)
    res.json({ data: { systemType: entry.session.systemType, transcript } })
  } catch (err: unknown) {
    sendError(res, 'FETCH_TRANSCRIPT', err, 'FETCH_ERROR')
  }
}))

router.get('/schedule', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  if (entry.session.systemType !== 'HAC') {
    res.status(400).json({
      data: null,
      error: {
        code: 'UNSUPPORTED',
        message: 'Schedule is only available for HAC districts',
      },
    })

    return
  }

  try {
    const cached = await readHacCache(req.userId!, 'schedule', HAC_CACHE_TTL_MS.schedule)
    if (cached) {
      res.json({ data: { schedule: cached } })
      return
    }

    const schedule = await getSchedule(entry.token)
    void writeHacCache(req.userId!, 'schedule', schedule)
    res.json({ data: { schedule } })
  } catch (err: unknown) {
    sendError(res, 'FETCH_SCHEDULE', err, 'FETCH_ERROR')
  }
}))

router.get('/gpa', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  try {
    let unweightedGpa: number | null = null
    let weightedGpa: number | null = null
    let courseCount = 0

    if (entry.session.systemType === 'HAC') {
      // Reuse transcript cache — GPA data lives on the same page
      const cachedTranscript = await readHacCache(req.userId!, 'transcript', HAC_CACHE_TTL_MS.transcript)
      const rawTranscript = cachedTranscript ?? await (async () => {
        const t = await hacTranscript(entry.token)
        void writeHacCache(req.userId!, 'transcript', t)
        return t
      })()
      const t = rawTranscript as { weightedGPA?: string | null; unweightedGPA?: string | null; semesters?: Array<{ courses: unknown[] }> }

      const w = parseFloat(t.weightedGPA ?? '')
      const u = parseFloat(t.unweightedGPA ?? '')
      if (!isNaN(w)) weightedGpa   = Math.round(w * 1000) / 1000
      if (!isNaN(u)) unweightedGpa = Math.round(u * 1000) / 1000

      courseCount = (t.semesters ?? []).reduce((acc, s) => acc + (s.courses?.length ?? 0), 0)
    } else {
      const ps = await psGrades(entry.token)
      courseCount = ps.length
      const rawGrades = ps.map(c => ({ average: c.grade }))
      const gpa = computeGPA(rawGrades)
      unweightedGpa = gpa
      weightedGpa   = gpa
    }

    // Persist GPA to Profile so counselors can see it
    const gpaUpdate: Record<string, number> = {}
    if (weightedGpa !== null)   gpaUpdate.weightedGpa   = weightedGpa
    if (unweightedGpa !== null) gpaUpdate.unweightedGpa = unweightedGpa
    if (Object.keys(gpaUpdate).length > 0) {
      await prisma.profile.upsert({
        where:  { userId: req.userId! },
        create: { userId: req.userId!, ...gpaUpdate },
        update: gpaUpdate,
      }).catch(() => { /* non-fatal */ })
    }

    res.json({
      data: {
        gpa: unweightedGpa,
        unweightedGpa,
        weightedGpa,
        courseCount,
        systemType: entry.session.systemType,
      },
    })
  } catch (err: unknown) {
    sendError(res, 'FETCH_GPA', err, 'FETCH_ERROR')
  }
}))

router.get('/info', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  if (entry.session.systemType !== 'HAC') {
    res.status(400).json({
      data: null,
      error: {
        code: 'UNSUPPORTED',
        message: 'Student info lookup is only available for HAC districts',
      },
    })

    return
  }

  try {
    const info = await getStudentInfo(entry.token)

    res.json({
      data: info,
    })
  } catch (err: unknown) {
    sendError(res, 'FETCH_STUDENT_INFO', err, 'FETCH_ERROR')
  }
}))

router.delete('/session', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!
  deleteSessionByUserId(userId)

  // Delete the SchoolConnection record entirely — this is a true disconnect.
  // autoRelogin checks for this record before attempting re-login, so removing it
  // prevents any silent refresh from re-establishing the HAC session.
  try {
    await prisma.schoolConnection.deleteMany({ where: { userId } })
  } catch (err) {
    console.warn('[GRADES ROUTER] Failed to delete SchoolConnection on disconnect:',
      err instanceof Error ? err.message : String(err))
  }

  res.json({ data: { disconnected: true } })
}))

router.get('/status', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!

  let entry = getSessionByUserId(userId)

  // If no in-memory session, proactively re-login with stored credentials so
  // subsequent grade requests don't have to pay the relogin cost themselves.
  // This is called by the app layout on every page load, so a real fresh
  // session is ready before the user navigates to any grade page.
  // We do NOT restore the stale DB-cached cookie here — HAC cookies expire in
  // ~60 min, so restoring a stale cookie into memory causes resolveSession to
  // skip auto-relogin and then fail when HAC rejects the dead cookie.
  if (!entry) {
    const reloginResult = await autoRelogin(userId)
    if (reloginResult?.session) entry = reloginResult.session
  }

  const connection = await prisma.schoolConnection.findUnique({
    where: { userId },
  })

  // Consider the portal "connected" if a SchoolConnection record exists
  // (user has linked their portal at least once), even if the in-memory
  // session expired. This prevents the UI from asking the user to
  // reconnect every time the backend restarts.
  const isConnected = Boolean(entry) || Boolean(connection)

  res.json({
    data: {
      connected: isConnected,
      systemType: entry?.session.systemType ?? connection?.systemType ?? null,
      districtUrl: entry?.session.baseUrl ?? connection?.districtUrl ?? null,
      lastSynced: connection?.lastSynced ?? null,
      sessionExpiresIn: entry
        ? Math.max(0, Math.floor((entry.session.expiresAt - Date.now()) / 1000))
        : 0,
    },
  })
}))

router.get('/sync-status', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!
  const connection = await prisma.schoolConnection.findUnique({
    where: { userId },
    select: { syncStatus: true, syncError: true, lastSynced: true, consecutiveSyncFailures: true },
  }).catch(() => null)

  if (!connection) {
    res.json({ data: { status: 'idle', lastSyncedAt: null, errorMessage: null, consecutiveSyncFailures: 0, portalDown: false } })
    return
  }

  // A portal is considered "down" when the last error is UNREACHABLE (the portal
  // was genuinely unreachable, not just a credentials problem) AND we have seen
  // at least 2 consecutive failures. Threshold of 2 avoids false-positive alerts
  // from a single transient network blip — two consecutive UNREACHABLE cycles
  // is a strong signal the portal itself is the problem.
  const portalDown =
    connection.syncError === 'UNREACHABLE' && connection.consecutiveSyncFailures >= 2

  res.json({
    data: {
      status: connection.syncStatus ?? 'idle',
      lastSyncedAt: connection.lastSynced ?? null,
      errorMessage: connection.syncError ?? null,
      consecutiveSyncFailures: connection.consecutiveSyncFailures,
      portalDown,
    },
  })
}))

router.get('/classwork', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  if (entry.session.systemType !== 'HAC') {
    res.status(400).json({ data: null, error: { code: 'UNSUPPORTED', message: 'Classwork is only available for HAC districts' } })
    return
  }

  try {
    touchSession(req.userId!)
    const period = req.query.period as string | undefined
    const cacheKey = `classwork:${period ?? '__default__'}`

    const cached = await readHacCache(req.userId!, cacheKey, CLASSWORK_TTL_MS)
    if (cached) {
      // Bypass old cache entries that predate category-weight scraping
      const hasWeights = (cached as { classes?: Array<{ categoryWeights?: unknown }> })
        .classes?.some(c => c.categoryWeights != null)
      if (hasWeights) {
        res.json({ data: cached })
        return
      }
    }

    const { classes, availablePeriods, currentPeriod } = await hacGrades(entry.token, period)
    void writeHacCache(req.userId!, cacheKey, { classes, availablePeriods, currentPeriod })
    res.json({ data: { classes, availablePeriods, currentPeriod } })
  } catch (err: unknown) {
    sendError(res, 'FETCH_CLASSWORK', err, 'FETCH_ERROR')
  }
}))

router.get('/report-card', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  if (entry.session.systemType !== 'HAC') {
    res.status(400).json({ data: null, error: { code: 'UNSUPPORTED', message: 'Report card is only available for HAC districts' } })
    return
  }

  try {
    touchSession(req.userId!)
    const period = req.query.period as string | undefined
    const cacheKey = `reportCard:${period ?? '__default__'}`

    const cached = await readHacCache(req.userId!, cacheKey, REPORT_CARD_TTL_MS)
    if (cached) {
      res.json({ data: cached })
      return
    }

    const { reportingPeriods, currentPeriod, message, courses } = await getReportCard(entry.token, period)
    const payload = { reportingPeriods, currentPeriod, courses, ...(message ? { message } : {}) }
    void writeHacCache(req.userId!, cacheKey, payload)
    res.json({ data: payload })
  } catch (err: unknown) {
    sendError(res, 'FETCH_REPORT_CARD', err, 'FETCH_ERROR')
  }
}))

router.get('/progress-report', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  if (entry.session.systemType !== 'HAC') {
    res.status(400).json({ data: null, error: { code: 'UNSUPPORTED', message: 'Progress report is only available for HAC districts' } })
    return
  }

  try {
    touchSession(req.userId!)
    const date = req.query.date as string | undefined
    const cacheKey = `progressReport:${date ?? '__default__'}`

    const cached = await readHacCache(req.userId!, cacheKey, PROGRESS_TTL_MS)
    if (cached) {
      res.json({ data: cached })
      return
    }

    const data = await getProgressReport(entry.token, date)
    void writeHacCache(req.userId!, cacheKey, data)
    res.json({ data })
  } catch (err: unknown) {
    sendError(res, 'FETCH_PROGRESS_REPORT', err, 'FETCH_ERROR')
  }
}))

router.get('/attendance', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  if (entry.session.systemType !== 'HAC') {
    res.status(400).json({ data: null, error: { code: 'UNSUPPORTED', message: 'Attendance is only available for HAC districts' } })
    return
  }

  try {
    touchSession(req.userId!)
    const offset = parseInt(String(req.query.monthOffset ?? '0')) || 0
    const cacheKey = `attendance:${offset}`

    const cached = await readHacCache(req.userId!, cacheKey, ATTENDANCE_TTL_MS)
    if (cached) {
      res.json({ data: cached })
      return
    }

    const data = await getAttendance(entry.token, offset)
    void writeHacCache(req.userId!, cacheKey, data)
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'ATTENDANCE',
      action: 'ATTENDANCE_VIEW',
      ipAddress: req.ip ?? 'unknown',
    })
    res.json({ data })
  } catch (err: unknown) {
    sendError(res, 'FETCH_ATTENDANCE', err, 'FETCH_ERROR')
  }
}))

router.get('/contact-teachers', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await resolveSession(req.userId!, res)
  if (!entry) return

  if (entry.session.systemType !== 'HAC') {
    res.status(400).json({ data: null, error: { code: 'UNSUPPORTED', message: 'Contact teachers is only available for HAC districts' } })
    return
  }

  try {
    touchSession(req.userId!)
    const cached = await readHacCache(req.userId!, 'contactTeachers', HAC_CACHE_TTL_MS.contactTeachers)
    if (cached) {
      res.json({ data: cached })
      return
    }

    const data = await getContactTeachers(entry.token)
    void writeHacCache(req.userId!, 'contactTeachers', data)
    res.json({ data })
  } catch (err: unknown) {
    sendError(res, 'FETCH_CONTACT_TEACHERS', err, 'FETCH_ERROR')
  }
}))

// ── Re-sync student profile from HAC (counselor, graduation year, name) ────
router.post('/sync-profile', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!

  // Force a fresh login rather than relying on a potentially-stale cached cookie.
  // autoRelogin uses stored encrypted credentials to get a brand-new HAC session.
  const connection = await prisma.schoolConnection.findUnique({ where: { userId } })
  if (!connection) {
    res.status(401).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No school portal connected. Go to Settings to connect your HAC account.' } })
    return
  }
  if (connection.systemType !== 'HAC') {
    res.status(400).json({ data: null, error: { code: 'UNSUPPORTED', message: 'Profile sync is only available for HAC districts' } })
    return
  }
  if (!connection.encryptedPassword) {
    res.status(401).json({ data: null, error: { code: 'NO_CREDENTIALS', message: 'No saved credentials. Go to Settings and sign in to your HAC account again to enable automatic re-sync.' } })
    return
  }

  const reloginResult = await autoRelogin(userId)
  if (!reloginResult?.session) {
    res.status(401).json({ data: null, error: { code: 'RELOGIN_FAILED', message: 'Could not sign in to HAC with your saved credentials. Your password may have changed — go to Settings to reconnect.' } })
    return
  }
  const entry = reloginResult.session

  try {
    touchSession(userId)
    console.log('[GRADES ROUTER] Re-syncing profile from HAC for userId:', userId)

    const studentInfo = await getStudentInfo(entry.token)
    const profileUpdate: Record<string, unknown> = {}
    const userUpdate: Record<string, unknown> = {}

    // Write to hacName — never overwrite the user's chosen display name
    if (studentInfo.name?.trim()) {
      userUpdate.hacName = studentInfo.name.trim()
    }

    // Update counselor from HAC
    if (studentInfo.counselor?.trim()) {
      profileUpdate.counselorName = studentInfo.counselor.trim()
    }

    // Parse and update graduation year from HAC cohort year
    const cohortNum = studentInfo.cohortYear ? parseInt(studentInfo.cohortYear.replace(/\D/g, ''), 10) : NaN
    if (!isNaN(cohortNum) && cohortNum > 2000 && cohortNum < 2060) {
      profileUpdate.graduationYear = cohortNum
    }

    // Update grade level from HAC if available
    const gradeNum = studentInfo.grade ? parseInt(studentInfo.grade.replace(/\D/g, ''), 10) : NaN
    if (!isNaN(gradeNum) && gradeNum >= 1 && gradeNum <= 12) {
      profileUpdate.gradeLevel = gradeNum
    }

    // Apply user updates (name)
    if (Object.keys(userUpdate).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: userUpdate })
      console.log('[GRADES ROUTER] Synced user from HAC for userId:', userId, 'fields:', Object.keys(userUpdate))
    }

    // DOB verification — compare HAC-reported DOB against self-reported DOB.
    // Non-fatal: a failure here must never prevent the profile sync response.
    if (studentInfo.dateOfBirth) {
      const parsedDob = parseHacDate(studentInfo.dateOfBirth)
      if (parsedDob) {
        try {
          const hacDobEncrypted = encryptDob(parsedDob)
          const userForDob = await prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } })
          if (userForDob) {
            const evaluation = userForDob.dateOfBirth
              ? evaluateDobVerification({ selfReportedDobEncrypted: userForDob.dateOfBirth, hacDobEncrypted })
              : { status: AccountStatus.DOB_MISMATCH_LOCKED, ageYears: null, bannedUntilDate: null }
            const auditAction = evaluation.status === AccountStatus.ACTIVE
              ? 'DOB_MATCH_VERIFIED'
              : evaluation.status === AccountStatus.UNDER_13_BANNED
                ? 'UNDER_13_BANNED'
                : 'DOB_MISMATCH_LOCKED'
            const ipAddress = req.ip ?? 'unknown'
            await prisma.$transaction([
              prisma.user.update({
                where: { id: userId },
                data: {
                  hacDateOfBirth: hacDobEncrypted,
                  accountStatus: evaluation.status,
                  bannedUntilDate: evaluation.bannedUntilDate,
                },
              }),
              prisma.complianceAuditLog.create({
                data: { userId, resourceType: 'user_identity', resourceId: String(userId), action: 'HAC_DOB_SYNCED', ipAddress },
              }),
              prisma.complianceAuditLog.create({
                data: { userId, resourceType: 'user_identity', resourceId: String(userId), action: auditAction, ipAddress },
              }),
            ])
          }
        } catch (dobErr) {
          logger.error('grades.dobVerification.failed', { userId, error: dobErr instanceof Error ? dobErr.message : String(dobErr) })
          // Non-fatal — DOB comparison failure must not abort the profile sync.
        }
      }
    }

    // Fetch and persist GPA from transcript
    try {
      const cachedTranscript = await readHacCache(userId, 'transcript', HAC_CACHE_TTL_MS.transcript)
      const rawTranscript = cachedTranscript ?? await (async () => {
        const t = await hacTranscript(entry.token)
        void writeHacCache(userId, 'transcript', t)
        return t
      })()
      const tr = rawTranscript as { weightedGPA?: string | null; unweightedGPA?: string | null }
      const w = parseFloat(tr.weightedGPA ?? '')
      const u = parseFloat(tr.unweightedGPA ?? '')
      if (!isNaN(w)) profileUpdate.weightedGpa   = Math.round(w * 1000) / 1000
      if (!isNaN(u)) profileUpdate.unweightedGpa = Math.round(u * 1000) / 1000
    } catch { /* GPA fetch is non-fatal */ }

    // Apply profile updates (counselor, graduation year, grade level, GPA)
    // Note: satScore, actScore, futureDecision are NOT overwritten — those are user-set
    let syncedProfile: Record<string, unknown> | null = null
    if (Object.keys(profileUpdate).length > 0) {
      syncedProfile = await prisma.profile.upsert({
        where: { userId },
        create: { userId, ...profileUpdate },
        update: profileUpdate,
      }) as Record<string, unknown>
      console.log('[GRADES ROUTER] Synced profile from HAC:', profileUpdate)
    }

    // Get the updated user name
    const updatedUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })

    res.json({
      data: {
        synced: true,
        name: updatedUser?.name ?? null,
        profile: syncedProfile,
        studentInfo: {
          name: studentInfo.name,
          grade: studentInfo.grade,
          school: studentInfo.school,
          district: studentInfo.district,
          counselor: studentInfo.counselor,
          cohortYear: studentInfo.cohortYear,
        },
      },
    })
  } catch (err: unknown) {
    sendError(res, 'SYNC_PROFILE', err, 'SYNC_ERROR')
  }
}))

export default router
import { safeConsole as console } from '../../common/safeConsole'
