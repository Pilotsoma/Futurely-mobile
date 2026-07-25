import 'dotenv/config'
import { logger } from './common/logger'

// Crash fast in production if JWT_SECRET is missing or is the default dev value
const DEFAULT_JWT_SECRET = 'futurely-dev-secret-change-in-production'
const LEGACY_DEFAULT_JWT_SECRET = 'nextstep-dev-secret-change-in-production'
if (
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET === DEFAULT_JWT_SECRET ||
  process.env.JWT_SECRET === LEGACY_DEFAULT_JWT_SECRET
) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('security_configuration_invalid', { variable: 'JWT_SECRET' })
    process.exit(1)
  } else {
    logger.warn('security_configuration_invalid', { variable: 'JWT_SECRET' })
  }
}

if (!/^[0-9a-f]{64}$/i.test(process.env.CREDENTIAL_ENCRYPTION_KEY ?? '')) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('security_configuration_invalid', { variable: 'CREDENTIAL_ENCRYPTION_KEY' })
    process.exit(1)
  } else {
    logger.warn('security_configuration_using_local_fallback', {
      variable: 'CREDENTIAL_ENCRYPTION_KEY',
      derivationSource: 'JWT_SECRET',
    })
  }
}

import express, { NextFunction, Response } from 'express'
import cors from 'cors'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import axios from 'axios'
import jwt from 'jsonwebtoken'
import authRoutes from './routes/auth'
import gradesRoutes from './routes/grades'
import assignmentsRouter from './routes/assignments'
import studentsRouter from './routes/students'
import roadmapRouter from './routes/roadmap'
import aiRouter from './routes/ai'
import feedRouter from './routes/feed'
import parentRouter from './routes/parent'
import notificationsRouter from './routes/notifications'
import collegesRouter from './routes/colleges'
import marketplaceRouter from './routes/marketplace'
import educatorRouter from './routes/educator'
import counselorRouter from './routes/counselor'
import adminRouter from './routes/admin'
import schoolsRouter from './routes/schools'
import setsRouter from './routes/sets'
import gamesRouter from './routes/games'
import agentSessionsRouter from './routes/agentSessions'
import usersRouter from './routes/users'
import cronRouter from './routes/cron'

import dobRouter from './routes/dob'
import { AuthRequest, requireAuth } from './middleware/auth'
import { requireConsent } from './middleware/requireConsent'
import { requireActiveAccount } from './middleware/requireActiveAccount'
import gradesIntegrationRouter from './integrations/grades/gradesRouter'
import canvasRouter from './integrations/canvas/canvasRouter'
import classlinkRouter from './integrations/classlink/classlinkRouter'
import { runWithAiRequestContext } from './lib/aiRequestContext'

const app = express()
const isProd = process.env.NODE_ENV === 'production'
const hasPostgresDatabaseUrl = /^postgres(?:ql)?:\/\//i.test(
  process.env.DATABASE_URL ?? '',
)

if (!hasPostgresDatabaseUrl) {
  logger.error('database_configuration_invalid', {
    variable: 'DATABASE_URL',
    expectedProtocol: 'postgresql',
  })
  if (isProd) process.exit(1)
}

// Always behind a reverse proxy (Vercel, Render, Railway) — trust one hop so
// req.ip resolves to the real client IP from X-Forwarded-For.
app.set('trust proxy', 1)

// ── Gzip compression — dramatically reduces Neon egress / bandwidth ──────────
app.use(compression())

// ── Security headers ────────────────────────────────────────────────────────
// crossOriginResourcePolicy is 'same-site': this is a pure JSON API with no
// public embeddable assets, so there is no reason for cross-origin pages to
// load resources from it directly.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}))

// ── CORS ─────────────────────────────────────────────────────────────────────
// Explicit allowlist — never a wildcard, never `origin: true`.
//
// Why !origin passes: native mobile clients (Expo Go, React Native fetch) and
// server-to-server calls omit the Origin header entirely. Allowing these is
// intentional and safe — browsers always send Origin on cross-site requests.
//
// Production: set ALLOWED_ORIGINS=https://app.futurely.app,https://... in .env
// Development: a small fixed allowlist covers Next.js (3000) and Expo web (19006).

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const DEV_ORIGINS = [
  'http://localhost:3000',  // Next.js web dev server
  'http://localhost:19006', // Expo web
  'http://localhost:8081',  // Expo bundler / Metro
]

// Use ALLOWED_ORIGINS if explicitly set (works regardless of NODE_ENV),
// otherwise fall back to DEV_ORIGINS. This handles Vercel's experimental
// backend where NODE_ENV may not be 'production'.
const ACTIVE_ORIGINS = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEV_ORIGINS
logger.info('cors_origins_configured', { originCount: ACTIVE_ORIGINS.length })

// Dev-only convenience: when testing the Expo web preview from a phone on the
// same WiFi (e.g. Safari at http://192.168.x.x:8081), the Origin header is the
// LAN IP, not localhost — which the fixed DEV_ORIGINS list above can't predict
// since it changes per network. This pattern only applies when ALLOWED_ORIGINS
// isn't explicitly set (i.e. never in production, where it's always set).
const isDevFallback = ALLOWED_ORIGINS.length === 0
const LAN_ORIGIN_PATTERN = /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):(3000|8081|19006)$/

const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Client-Platform', 'X-AI-Skip-Primary']
// Expose rate-limit headers so clients can read their quota without guessing,
// and X-AI-Used-Fallback so the client can remember to skip the primary AI
// model for the rest of this session once it's seen a fallback happen.
const CORS_EXPOSED_HEADERS = ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy', 'X-AI-Used-Fallback']

app.use(cors({
  origin: (origin, cb) => {
    // No Origin header = native mobile / server-to-server — allow.
    if (!origin) return cb(null, true)

    if (ACTIVE_ORIGINS.includes(origin)) return cb(null, true)

    if (isDevFallback && LAN_ORIGIN_PATTERN.test(origin)) return cb(null, true)

    const allowedStr = ACTIVE_ORIGINS.length > 0 ? ACTIVE_ORIGINS.join(', ') : '(none)'
    cb(new Error(`CORS: origin '${origin}' is not allowed. Allowed origins: ${allowedStr}`))
  },
  credentials: true,
  methods: CORS_METHODS,
  allowedHeaders: CORS_ALLOWED_HEADERS,
  exposedHeaders: CORS_EXPOSED_HEADERS,
  maxAge: 86400, // cache preflight for 24 h — reduces OPTIONS round-trips
}))

// ── Cookie parser — required for httpOnly cookie auth (web clients) ───────────
app.use(cookieParser())

// ── Body size limit — prevent large-payload DoS ──────────────────────────────
app.use(express.json({ limit: '50kb' }))
app.use(express.urlencoded({ extended: true, limit: '50kb' }))


// ── Global rate limiter — 1000 req / 15 min per IP ───────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { data: null, error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down.' } },
  handler: (req, res, _next, options) => {
    logger.warn('rate_limit_hit', { type: 'global', ip: req.ip, path: req.originalUrl })
    res.status(options.statusCode).json(options.message)
  },
})
app.use(globalLimiter)

// ── Strict limiters for expensive / sensitive endpoints ──────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { data: null, error: { code: 'RATE_LIMITED', message: 'Too many auth attempts, try again later.' } },
  handler: (req, res, _next, options) => {
    logger.warn('rate_limit_hit', { type: 'auth', ip: req.ip, path: req.originalUrl })
    res.status(options.statusCode).json(options.message)
  },
})

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { data: null, error: { code: 'RATE_LIMITED', message: 'AI rate limit reached, wait a moment.' } },
  handler: (req, res, _next, options) => {
    logger.warn('rate_limit_hit', { type: 'ai', ip: req.ip, path: req.originalUrl })
    res.status(options.statusCode).json(options.message)
  },
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { data: null, error: { code: 'RATE_LIMITED', message: 'Too many accounts created from this IP.' } },
  handler: (req, res, _next, options) => {
    logger.warn('rate_limit_hit', { type: 'register', ip: req.ip })
    res.status(options.statusCode).json(options.message)
  },
})


app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    logger.info('http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ip: req.ip,
      duration_ms: Date.now() - start,
    })
  })
  next()
})

// Lets the client tell us (once it's seen a fallback happen this session)
// to skip straight to the reliable AI model on every subsequent request,
// instead of paying for a doomed primary-model attempt each time. See
// lib/aiRequestContext.ts and lib/aiClient.ts's createChatCompletion().
app.use((req, res, next) => {
  const skipPrimary = req.headers['x-ai-skip-primary'] === '1'
  runWithAiRequestContext(res, skipPrimary, next)
})

app.get('/health', async (_req, res) => {
  try {
    const { prisma } = await import('./lib/prisma')
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected' })
  } catch (err) {
    logger.error('health.database_unreachable', {
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(503).json({ status: 'error', db: 'unreachable' })
  }
})

if (!isProd) app.get('/health/connectivity', async (_req, res) => {
  const testUrl = 'https://homeaccess.katyisd.org/HomeAccess/Account/LogOn'

  try {
    const result = await axios.get<string>(testUrl, {
      timeout: 10_000,
      validateStatus: () => true,
    })

    res.json({
      status: 'reachable',
      hacStatusCode: result.status,
      url: testUrl,
      message: 'Backend can reach HAC portal',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const code = (err as { code?: string }).code

    res.json({
      status: 'unreachable',
      error: message,
      code,
      url: testUrl,
      message: 'Backend CANNOT reach HAC — this is the root cause of login failures',
    })
  }
})

// Auth routes get their own tight limiter; register gets an even stricter one
app.use('/auth/register', registerLimiter)
app.use('/auth', authLimiter, authRoutes)
// Mounted separately from authRoutes so it isn't itself gated behind
// requireActiveAccount below — a DOB_MISMATCH_LOCKED user must be able to
// reach this endpoint to correct their DOB and unlock the account.
app.use('/auth/dob', authLimiter, requireAuth, dobRouter)
app.use('/schools', schoolsRouter)
app.use('/grades', requireAuth, requireConsent, requireActiveAccount, gradesRoutes)

/**
 * TEMPORARY LOCAL DEV ONLY:
 * When ENABLE_DEV_INTEGRATION_AUTH_BYPASS=true (set in .env), all protected
 * routes inject userId=1 so the app works without a JWT.  This lets you test
 * on-device via Expo Go without going through the full auth flow first.
 *
 * Before production, set ENABLE_DEV_INTEGRATION_AUTH_BYPASS=false.
 */
const ENABLE_DEV_INTEGRATION_AUTH_BYPASS =
  process.env.ENABLE_DEV_INTEGRATION_AUTH_BYPASS === 'true'

// Hard safety net: this flag defaults every protected route (including /admin)
// to userId=1 with zero authentication. It must never be reachable in
// production — crash immediately rather than silently exposing everything.
if (ENABLE_DEV_INTEGRATION_AUTH_BYPASS && isProd) {
  logger.error('security_configuration_invalid', {
    variable: 'ENABLE_DEV_INTEGRATION_AUTH_BYPASS',
  })
  process.exit(1)
}

function devBypass(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers?.authorization as string | undefined
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7)
      const secret = process.env.JWT_SECRET!
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { sub?: number | string }
      const id = typeof payload.sub === 'number'
        ? payload.sub
        : parseInt(String(payload.sub), 10)
      if (!isNaN(id)) {
        req.userId = id
        next()
        return
      }
    } catch {
      // Token invalid — fall through to default
    }
  }
  req.userId = 1
  next()
}

if (ENABLE_DEV_INTEGRATION_AUTH_BYPASS) {
  logger.warn('development_auth_bypass_active')
  app.use('/assignments', devBypass, requireConsent, requireActiveAccount, assignmentsRouter)
  app.use('/students', devBypass, requireConsent, requireActiveAccount, studentsRouter)
  app.use('/roadmap', devBypass, requireConsent, requireActiveAccount, roadmapRouter)
  app.use('/ai/agent', aiLimiter, devBypass, requireConsent, requireActiveAccount, agentSessionsRouter)
  app.use('/ai', aiLimiter, devBypass, requireConsent, requireActiveAccount, aiRouter)
  app.use('/users', devBypass, requireConsent, requireActiveAccount, usersRouter)
  app.use('/feed', devBypass, requireConsent, requireActiveAccount, feedRouter)
  app.use('/notifications', devBypass, requireConsent, requireActiveAccount, notificationsRouter)
  app.use('/integrations/grades', devBypass, requireConsent, requireActiveAccount, gradesIntegrationRouter)
  app.use('/integrations/canvas', devBypass, requireConsent, requireActiveAccount, canvasRouter)
  app.use('/integrations/classlink', devBypass, requireConsent, requireActiveAccount, classlinkRouter)
  app.use('/colleges', devBypass, requireConsent, requireActiveAccount, collegesRouter)
  app.use('/marketplace', devBypass, requireConsent, requireActiveAccount, marketplaceRouter)
  app.use('/educator', devBypass, requireConsent, requireActiveAccount, educatorRouter)
  app.use('/counselor', devBypass, requireConsent, requireActiveAccount, counselorRouter)
  app.use('/admin', devBypass, requireConsent, requireActiveAccount, adminRouter)
  app.use('/sets', devBypass, requireConsent, requireActiveAccount, setsRouter)
  app.use('/games', devBypass, requireConsent, requireActiveAccount, gamesRouter)

} else {
  app.use('/assignments', requireAuth, requireConsent, requireActiveAccount, assignmentsRouter)
  app.use('/students', requireAuth, requireConsent, requireActiveAccount, studentsRouter)
  app.use('/roadmap', requireAuth, requireConsent, requireActiveAccount, roadmapRouter)
  // Agent session routes — mounted before the generic /ai handler so
  // express-rate-limit and requireConsent are applied consistently.
  app.use('/ai/agent', aiLimiter, requireAuth, requireConsent, requireActiveAccount, agentSessionsRouter)
  app.use('/ai', aiLimiter, requireAuth, requireConsent, requireActiveAccount, aiRouter)
  app.use('/users', requireAuth, requireConsent, requireActiveAccount, usersRouter)
  app.use('/feed', requireAuth, requireConsent, requireActiveAccount, feedRouter)
  app.use('/notifications', requireAuth, requireConsent, requireActiveAccount, notificationsRouter)
  app.use('/integrations/grades', requireAuth, requireConsent, requireActiveAccount, gradesIntegrationRouter)
  app.use('/integrations/canvas', requireAuth, requireConsent, requireActiveAccount, canvasRouter)
  app.use('/integrations/classlink', requireAuth, requireConsent, requireActiveAccount, classlinkRouter)
  app.use('/colleges', requireAuth, requireConsent, requireActiveAccount, collegesRouter)
  app.use('/marketplace', requireAuth, requireConsent, requireActiveAccount, marketplaceRouter)
  app.use('/educator', requireAuth, requireConsent, requireActiveAccount, educatorRouter)
  app.use('/counselor', requireAuth, requireConsent, requireActiveAccount, counselorRouter)
  app.use('/admin', requireAuth, requireConsent, requireActiveAccount, adminRouter)
  app.use('/sets', requireAuth, requireConsent, requireActiveAccount, setsRouter)
  app.use('/games', requireAuth, requireConsent, requireActiveAccount, gamesRouter)

}

app.use('/parent', authLimiter, requireAuth, requireConsent, requireActiveAccount, parentRouter)

// ── Cron endpoints — secret-based auth only, no user session middleware ───────
// Reachable at /api/cron/... via vercel.json's /api routePrefix.
// Must be mounted OUTSIDE the requireAuth/requireConsent blocks above.
app.use('/cron', cronRouter)

// Keep every API response machine-readable, including unknown routes.
app.use((_req, res) => {
  res.status(404).json({
    data: null,
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  })
})

// ── Global error handler ─────────────────────────────────────────────────────
// Catches any error passed to next(err) or thrown inside non-async route handlers.
// Must be registered AFTER all routes and have exactly four parameters.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  const errorStatus = (err as { status?: unknown } | null)?.status
  const isCorsError = message.startsWith('CORS:')
  const status =
    isCorsError ? 403 :
    typeof errorStatus === 'number' && errorStatus >= 400 && errorStatus < 500
      ? errorStatus
      : 500

  logger.error('http_unhandled_error', { message, stack, status })

  if (!res.headersSent) {
    res.status(status).json({
      data: null,
      error: {
        code:
          isCorsError ? 'ORIGIN_NOT_ALLOWED' :
          status === 413 ? 'PAYLOAD_TOO_LARGE' :
          status < 500 ? 'BAD_REQUEST' :
          'INTERNAL_ERROR',
        message:
          isCorsError ? 'Request origin is not allowed.' :
          status === 413 ? 'Request body is too large.' :
          status < 500 ? 'Invalid request.' :
          'An unexpected error occurred.',
      },
    })
  }
})

export default app
