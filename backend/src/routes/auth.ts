import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { promises as dnsPromises } from 'dns'
import rateLimit from 'express-rate-limit'
import { AccountStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { filterUsername } from '../lib/contentFilter'
import { sendEmail } from '../lib/email'
import { logger } from '../common/logger'
import { validateDobInput, encryptDob, MAX_DOB_CORRECTION_ATTEMPTS, liftExpiredBanIfNeeded } from '../lib/dobVerification'
import { buildMobileOAuthRedirect, validateMobileOAuthRedirectUri } from '../lib/mobileOAuth'

const router = Router()

// ── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 10
const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRY_DAYS = 7
const RESET_TOKEN_EXPIRY_MINUTES = 15
const VERIFY_TOKEN_EXPIRY_HOURS = 24
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 2 * 60 * 60 * 1000 // 2 hours

// Stable dummy hash used to normalise timing when user doesn't exist
const DUMMY_HASH = '$2a$12$RhIbHdMHqDGwkVDSMsqmNOE7I1NLSq9k3n7N4wWfpjBYUdpFCt/0G'

// ── Rate limiters ─────────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again in 15 minutes.' },
  },
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many registration attempts from this IP.' },
  },
})

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many password reset attempts. Try again in 1 hour.' },
  },
})

const refreshTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many token refresh attempts. Try again in 15 minutes.' },
  },
})

const verifyEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many email verification attempts. Try again in 1 hour.' },
  },
})

const resendVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many resend requests. Try again in 1 hour.' },
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter'
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number'
  return null
}

// accountStatus is embedded as a convenience claim only (e.g. for optimistic
// frontend UI) — it is never trusted as the source of truth for access
// control. requireActiveAccount always re-reads accountStatus from the DB,
// since it can change mid-session, well within this token's 15-minute life.
function issueAccessToken(userId: number, role = 'STUDENT', accountStatus: AccountStatus = AccountStatus.ACTIVE): string {
  return jwt.sign({ sub: userId, role, accountStatus }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_EXPIRY })
}

// Web sends this header (see lib/api.ts) and relies entirely on the httpOnly
// cookies set alongside this response — so the raw token never needs to appear
// in a web response body at all. Mobile has no cookie jar and still needs it.
function isWebClient(req: Request): boolean {
  return req.headers['x-client-platform'] === 'web'
}

const IS_PROD = process.env.NODE_ENV === 'production'

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  const base = { httpOnly: true, path: '/', sameSite: IS_PROD ? ('none' as const) : ('lax' as const), secure: IS_PROD }
  res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 })
  res.cookie('refresh_token', refreshToken, { ...base, maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000 })
}

function clearAuthCookies(res: Response): void {
  const base = { httpOnly: true, path: '/', sameSite: IS_PROD ? ('none' as const) : ('lax' as const), secure: IS_PROD }
  res.clearCookie('access_token', base)
  res.clearCookie('refresh_token', base)
}

async function issueRefreshToken(userId: number): Promise<string> {
  const token = crypto.randomBytes(40).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS)
  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } })
  return token
}

async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'https://myfuturely.ai'
  const link = `${appUrl}/verify-email?token=${token}`
  await sendEmail({
    to: email,
    subject: 'Verify your myFuturely email',
    html: `
      <p>Welcome to myFuturely!</p>
      <p>Please verify your email address by clicking the link below:</p>
      <p><a href="${link}">Verify Email</a></p>
      <p>This link expires in ${VERIFY_TOKEN_EXPIRY_HOURS} hours.</p>
      <p>If you didn't create an account, you can safely ignore this email.</p>
    `,
  })
}

// Returns false only when DNS conclusively confirms the domain has no mail handler.
// Fails open on timeouts/SERVFAIL so transient DNS issues don't block real users.
async function hasValidMailDomain(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain || !domain.includes('.')) return false
  try {
    const records = await dnsPromises.resolveMx(domain)
    return records.length > 0
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') return false
    return true // SERVFAIL, ETIMEOUT, etc. → fail open
  }
}

async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'https://myfuturely.ai'
  const link = `${appUrl}/reset-password?token=${token}`
  await sendEmail({
    to: email,
    subject: 'Reset your myFuturely password',
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F4FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4FF;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:18px;border:1px solid #C0CCE8;box-shadow:0 8px 40px rgba(26,21,14,0.08);overflow:hidden;">
        <tr>
          <td style="padding:36px 40px 28px;text-align:center;border-bottom:1px solid #C0CCE8;">
            <span style="font-size:28px;font-weight:700;color:#050B18;letter-spacing:-0.5px;">myFuturely</span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px 28px;">
            <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#050B18;">Reset your password</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#3D4F72;line-height:1.6;">
              We received a request to reset your myFuturely password. Click the button below — this link expires in <strong>${RESET_TOKEN_EXPIRY_MINUTES} minutes</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center">
                  <a href="${link}" style="display:inline-block;background:#2979FF;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;letter-spacing:0.1px;">
                    Reset my password
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 0;font-size:13px;color:#7B8DB0;line-height:1.6;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${link}" style="color:#2979FF;word-break:break-all;">${link}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #C0CCE8;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7B8DB0;line-height:1.5;">
              If you didn't request a password reset, you can safely ignore this email.<br>
              Your password won't change.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

// ── POST /auth/register ───────────────────────────────────────────────────────

router.post('/register', registerLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password, name, role: roleInput, otp, agreedTos, agreedPrivacy, agreedAge, dateOfBirth } = req.body as {
    email?: string
    password?: string
    name?: string
    role?: string
    otp?: string
    agreedTos?: unknown
    agreedPrivacy?: unknown
    agreedAge?: unknown
    dateOfBirth?: string
  }

  if (!email || !password) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'email and password required' },
    })
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Please enter a valid email address.' },
    })
    return
  }

  const domainValid = await hasValidMailDomain(email)
  if (!domainValid) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'That email domain doesn\'t appear to be valid. Please check for typos.' },
    })
    return
  }

  const passError = validatePassword(password)
  if (passError) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: passError },
    })
    return
  }

  // Display name is optional — only validate if provided
  const displayName = name?.trim() || null
  if (displayName) {
    const nameCheck = filterUsername(displayName)
    if (!nameCheck.ok) {
      res.status(400).json({
        data: null,
        error: { code: 'INAPPROPRIATE_NAME', message: nameCheck.reason },
      })
      return
    }
  }

  // Consent is required before account creation — all three must be strictly true
  if (agreedTos !== true || agreedPrivacy !== true || agreedAge !== true) {
    res.status(400).json({
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'You must agree to the Terms of Service, Privacy Policy, and confirm your age to register.',
      },
    })
    return
  }

  // Date of birth is required for students — it is later reconciled against
  // the official HAC (school portal) record; a mismatch locks the account
  // until corrected via PATCH /auth/dob. Non-student roles (parent/teacher/
  // counselor) never sync against HAC, so DOB is not collected for them.
  const isStudentSignup = roleInput !== 'PARENT' && roleInput !== 'TEACHER' && roleInput !== 'COUNSELOR'
  let encryptedDob: string | null = null
  if (isStudentSignup) {
    const dobCheck = validateDobInput(dateOfBirth)
    if (!dobCheck.ok || !dobCheck.isoDate) {
      res.status(400).json({
        data: null,
        error: {
          code: dobCheck.errorCode ?? 'VALIDATION_ERROR',
          message: dobCheck.error ?? 'A valid date of birth is required.',
        },
      })
      return
    }
    encryptedDob = encryptDob(dobCheck.isoDate)
  }

  try {
    const [emailTaken, nameTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      displayName ? prisma.user.findFirst({ where: { name: displayName } }) : Promise.resolve(null),
    ])
    if (emailTaken) {
      res.status(409).json({
        data: null,
        error: { code: 'CONFLICT', message: 'An account with this email already exists' },
      })
      return
    }
    if (nameTaken) {
      res.status(409).json({
        data: null,
        error: { code: 'NAME_TAKEN', message: 'That display name is already taken. Please choose another.' },
      })
      return
    }

    // Verify OTP
    if (!otp) {
      res.status(400).json({ data: null, error: { code: 'OTP_REQUIRED', message: 'Verification code required.' } })
      return
    }
    const codeHash = crypto.createHash('sha256').update(otp.trim()).digest('hex')
    const otpRecord = await prisma.emailOTP.findFirst({
      where: { email, codeHash, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!otpRecord) {
      res.status(400).json({ data: null, error: { code: 'INVALID_OTP', message: 'Invalid or expired verification code.' } })
      return
    }
    await prisma.emailOTP.update({ where: { id: otpRecord.id }, data: { usedAt: new Date() } })

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const userRole = roleInput === 'PARENT' ? 'PARENT' : roleInput === 'TEACHER' ? 'TEACHER' : roleInput === 'COUNSELOR' ? 'COUNSELOR' : 'STUDENT'
    const defaultTag = userRole === 'PARENT' ? 'Parent' : userRole === 'TEACHER' || userRole === 'COUNSELOR' ? 'Teacher' : 'Student'

    const consentTimestamp = new Date()
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: displayName,
          role: userRole,
          tag: defaultTag,
          tagColor: 'grey',
          emailVerified: true,
          tosAcceptedAt: consentTimestamp,
          privacyAcceptedAt: consentTimestamp,
          ageConfirmedAt: consentTimestamp,
          dateOfBirth: encryptedDob,
        },
      })

      // Email is already verified via OTP — no verification link needed

      await tx.complianceAuditLog.create({
        data: {
          userId: created.id,
          resourceType: 'consent',
          resourceId: String(created.id),
          action: 'ACCEPT',
          ipAddress: req.ip ?? 'unknown',
        },
      })

      if (encryptedDob) {
        await tx.complianceAuditLog.create({
          data: {
            userId: created.id,
            resourceType: 'user_identity',
            resourceId: String(created.id),
            action: 'DOB_COLLECTED',
            ipAddress: req.ip ?? 'unknown',
          },
        })
      }

      return created
    })

    const token = issueAccessToken(user.id, user.role)
    const refreshToken = await issueRefreshToken(user.id)
    setAuthCookies(res, token, refreshToken)

    logger.info('auth.registered', { userId: user.id })

    res.status(201).json({
      data: {
        ...(isWebClient(req) ? {} : { token, refreshToken }),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: true,
          accountStatus: user.accountStatus,
          bannedUntilDate: user.bannedUntilDate,
        },
      },
    })
  } catch (e) {
    logger.error('auth.error', { event: 'register', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── POST /auth/login ──────────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string }

  if (!email || !password) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'email and password required' },
    })
    return
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } })

    // Always run bcrypt regardless of whether user exists — prevents timing-based
    // user enumeration (attacker can't tell if email is registered from response time)
    const passwordValid = user
      ? user.passwordHash
        ? await bcrypt.compare(password, user.passwordHash)
        : await bcrypt.compare(password, DUMMY_HASH).then(() => false) // OAuth-only account
      : await bcrypt.compare(password, DUMMY_HASH).then(() => false)

    if (!user) {
      res.status(401).json({
        data: null,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      })
      return
    }



    if (user.lockedUntil && user.lockedUntil > new Date()) {
      logger.warn('auth.login_rejected_locked', { userId: user.id, ip: req.ip })
      const secondsRemaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000)
      res.status(429).json({
        data: null,
        error: { code: 'ACCOUNT_LOCKED', message: 'Account temporarily locked due to too many failed login attempts' },
        secondsRemaining,
      })
      return
    }

    if (!passwordValid) {
      const newAttempts = (user.failedLoginAttempts ?? 0) + 1
      const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newAttempts,
          ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } : {}),
        },
      })

      if (shouldLock) {
        logger.warn('auth.account_locked', { userId: user.id, ip: req.ip })
        res.status(429).json({
          data: null,
          error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed login attempts. Account locked for 2 hours.' },
          secondsRemaining: LOCKOUT_DURATION_MS / 1000,
        })
        return
      }

      logger.warn('auth.login_failed', { userId: user.id, ip: req.ip, attempts: newAttempts })
      const attemptsLeft = MAX_FAILED_ATTEMPTS - newAttempts
      res.status(401).json({
        data: null,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: `Invalid email or password. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before lockout.`,
        },
      })
      return
    }

    // Reset failed attempts on successful login
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })

    const token = issueAccessToken(user.id, user.role, user.accountStatus)
    const refreshToken = await issueRefreshToken(user.id)
    setAuthCookies(res, token, refreshToken)

    logger.info('auth.login_success', { userId: user.id })

    res.json({
      data: {
        ...(isWebClient(req) ? {} : { token, refreshToken }),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: user.emailVerified,
          accountStatus: user.accountStatus,
          bannedUntilDate: user.bannedUntilDate,
        },
      },
    })
  } catch (e) {
    logger.error('auth.error', { event: 'login', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── POST /auth/refresh ────────────────────────────────────────────────────────

router.post('/refresh', refreshTokenLimiter, async (req: Request, res: Response): Promise<void> => {
  // Accept refresh token from body (mobile) or httpOnly cookie (web)
  const refreshToken = (req.body as { refreshToken?: string }).refreshToken
    ?? (req as Request & { cookies?: Record<string, string> }).cookies?.refresh_token

  if (!refreshToken) {
    res.status(401).json({
      data: null,
      error: { code: 'INVALID_TOKEN', message: 'No refresh token provided' },
    })
    return
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } })

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      logger.warn('auth.invalid_refresh_token', { ip: req.ip })
      clearAuthCookies(res)
      res.status(401).json({
        data: null,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired refresh token' },
      })
      return
    }

    // Rotate: revoke old and create new in parallel (both depend only on stored, not each other)
    const [newRefreshToken,, refreshedUser] = await Promise.all([
      issueRefreshToken(stored.userId),
      prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
      prisma.user.findUnique({ where: { id: stored.userId }, select: { role: true, accountStatus: true } }),
    ])

    const newAccessToken = issueAccessToken(stored.userId, refreshedUser?.role ?? 'STUDENT', refreshedUser?.accountStatus)
    setAuthCookies(res, newAccessToken, newRefreshToken)

    logger.info('auth.token_refreshed', { userId: stored.userId })

    res.json({
      data: isWebClient(req) ? {} : { token: newAccessToken, refreshToken: newRefreshToken },
    })
  } catch (e) {
    logger.error('auth.error', { event: 'refresh', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── POST /auth/logout ─────────────────────────────────────────────────────────

// Deliberately NOT behind requireAuth: idle-timeout logout can fire well after
// the 15-minute access token has expired (idle threshold alone is 10min+3min),
// and gating this on a valid access token meant an expired one made requireAuth
// reject the request with 401 before the handler ever ran — clearAuthCookies
// never executed, the refresh token stayed valid, and the frontend's
// `.catch(() => null)` swallowed the failure, so logout silently no-opped while
// looking like it worked. Logout must succeed even when the session already
// looks expired from the caller's side.
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  const refreshToken = (req.body as { refreshToken?: string }).refreshToken
    ?? (req as Request & { cookies?: Record<string, string> }).cookies?.refresh_token

  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
    await prisma.refreshToken
      .updateMany({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      })
      .catch(() => { /* token not found — fine */ })
  }

  clearAuthCookies(res)
  logger.info('auth.logout', { hadRefreshToken: !!refreshToken })
  res.json({ data: { ok: true } })
})

// ── POST /auth/forgot-password ────────────────────────────────────────────────

router.post('/forgot-password', passwordResetLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email?: string }

  if (!email) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'email required' },
    })
    return
  }

  // Basic format check before DNS lookup
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Please enter a valid email address.' },
    })
    return
  }

  // MX-record check: reject domains that provably cannot receive email.
  // This catches typos like @gmal.com or @fakdomain — not whether an account exists.
  const domainValid = await hasValidMailDomain(email)
  if (!domainValid) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'That email domain doesn\'t appear to be valid. Please check for typos.' },
    })
    return
  }

  // Do all work before responding — on Vercel serverless the function can be
  // killed immediately after res.json(), so fire-and-forget after the response
  // is unreliable. Always return the same generic message to prevent enumeration.
  try {
    const user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'No account found with that email address.' } })
      return
    }

    // Invalidate any existing unused tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date()
    expiresAt.setMinutes(expiresAt.getMinutes() + RESET_TOKEN_EXPIRY_MINUTES)

    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } })
    logger.info('auth.password_reset_requested', { userId: user.id })

    await sendPasswordResetEmail(email, rawToken)
  } catch (e) {
    logger.error('auth.error', { event: 'forgot_password', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } })
    return
  }

  res.json({ data: { message: 'Reset link sent.' } })
})

// ── POST /auth/reset-password ─────────────────────────────────────────────────

router.post('/reset-password', passwordResetLimiter, async (req: Request, res: Response): Promise<void> => {
  const { token, password } = req.body as { token?: string; password?: string }

  if (!token || !password) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'token and password required' },
    })
    return
  }

  const passError = validatePassword(password)
  if (passError) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: passError },
    })
    return
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    // Atomically claim the token — prevents TOCTOU race where two concurrent requests
    // both pass the usedAt check before either marks it consumed
    const claimed = await prisma.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })

    if (claimed.count === 0) {
      res.status(400).json({
        data: null,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset token' },
      })
      return
    }

    const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })
    if (!resetToken) {
      res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
      return
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      // Force re-login on all devices after password reset
      prisma.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])

    clearAuthCookies(res)
    logger.info('auth.password_reset_success', { userId: resetToken.userId })
    res.json({ data: { message: 'Password reset successful. Please log in again.' } })
  } catch (e) {
    logger.error('auth.error', { event: 'reset_password', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── POST /auth/verify-email ───────────────────────────────────────────────────

router.post('/verify-email', verifyEmailLimiter, async (req: Request, res: Response): Promise<void> => {
  const { token } = req.body as { token?: string }

  if (!token) {
    res.status(400).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'token required' },
    })
    return
  }

  try {
    const user = await prisma.user.findFirst({
      where: { emailVerificationToken: token, emailVerified: false },
    })

    if (!user) {
      res.status(400).json({
        data: null,
        error: { code: 'INVALID_TOKEN', message: 'Invalid verification token' },
      })
      return
    }

    if (user.emailVerificationExpiry && user.emailVerificationExpiry < new Date()) {
      res.status(400).json({
        data: null,
        error: { code: 'TOKEN_EXPIRED', message: 'Verification token expired. Request a new one.' },
      })
      return
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      },
    })

    logger.info('auth.email_verified', { userId: user.id })
    res.json({ data: { message: 'Email verified successfully' } })
  } catch (e) {
    logger.error('auth.error', { event: 'verify_email', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── POST /auth/resend-verification ────────────────────────────────────────────

router.post('/resend-verification', resendVerifyLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })

    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }
    if (user.emailVerified) {
      res.status(400).json({ data: null, error: { code: 'ALREADY_VERIFIED', message: 'Email already verified' } })
      return
    }

    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationExpiry = new Date()
    verificationExpiry.setHours(verificationExpiry.getHours() + VERIFY_TOKEN_EXPIRY_HOURS)

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: verificationToken, emailVerificationExpiry: verificationExpiry },
    })

    void sendVerificationEmail(user.email, verificationToken).catch((err) =>
      console.error('Failed to send verification email:', err),
    )

    res.json({ data: { message: 'Verification email sent' } })
  } catch (e) {
    logger.error('auth.error', { event: 'resend_verification', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── GET /auth/me ──────────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [user, schoolConn] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          createdAt: true,
          accountStatus: true,
          bannedUntilDate: true,
          dobCorrectionAttempts: true,
          hacDateOfBirth: true,
        },
      }),
      prisma.schoolConnection.findUnique({ where: { userId: req.userId }, select: { id: true } }),
    ])
    if (!user) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      })
      return
    }
    const lifted = await liftExpiredBanIfNeeded(user.id, user.accountStatus, user.bannedUntilDate, req.ip ?? 'unknown')
    const { hacDateOfBirth, ...userWithoutHacDob } = user
    res.json({
      data: {
        ...userWithoutHacDob,
        accountStatus: lifted.accountStatus,
        bannedUntilDate: lifted.bannedUntilDate,
        hasSchoolConnection: schoolConn !== null,
        // Whether a school-record DOB has ever been synced — distinguishes a
        // genuine detected mismatch from "hasn't connected/synced yet, so
        // there's simply nothing to compare against." Never expose the raw
        // hacDateOfBirth ciphertext itself.
        hasSchoolRecord: hacDateOfBirth !== null,
      },
    })
  } catch (e) {
    logger.error('auth.error', { event: 'me', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── GET /auth/account-status ────────────────────────────────────────────────
// Lightweight poll endpoint for the frontend to check whether the account is
// locked/banned without pulling the full /me payload — used by the DOB
// correction screen and by clients reacting to a 403 DOB_VERIFICATION_REQUIRED
// / ACCOUNT_BANNED from requireActiveAccount elsewhere in the API.
// Deliberately exempt from requireActiveAccount (mounted outside that chain
// via auth.ts) so a locked/banned user can still poll their own status.

router.get('/account-status', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [user, schoolConn] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId },
        select: { accountStatus: true, bannedUntilDate: true, dobCorrectionAttempts: true, hacDateOfBirth: true },
      }),
      prisma.schoolConnection.findUnique({ where: { userId: req.userId }, select: { id: true } }),
    ])
    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }
    const lifted = await liftExpiredBanIfNeeded(req.userId!, user.accountStatus, user.bannedUntilDate, req.ip ?? 'unknown')
    res.json({
      data: {
        accountStatus: lifted.accountStatus,
        bannedUntilDate: lifted.bannedUntilDate,
        dobCorrectionAttempts: user.dobCorrectionAttempts,
        dobCorrectionAttemptsRemaining: Math.max(0, MAX_DOB_CORRECTION_ATTEMPTS - user.dobCorrectionAttempts),
        hasSchoolRecord: user.hacDateOfBirth !== null,
        hasSchoolConnection: schoolConn !== null,
      },
    })
  } catch (e) {
    logger.error('auth.error', { event: 'account_status', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── DELETE /auth/account ──────────────────────────────────────────────────────

router.delete('/account', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!
  const { password } = req.body as { password?: string }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }

    if (user.passwordHash) {
      // Password account — require password verification
      if (!password) {
        res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Password required' } })
        return
      }
      const valid = await bcrypt.compare(password, user.passwordHash)
      if (!valid) {
        res.status(401).json({ data: null, error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect password' } })
        return
      }
    }
    // OAuth-only account — no password needed, just the DELETE confirmation from the frontend

    // Hard delete — cascades to all related records (posts, likes, comments, etc.)
    await prisma.user.delete({ where: { id: userId } })

    logger.info('auth.account_deleted', { userId })
    res.json({ data: { deleted: true } })
  } catch (e) {
    logger.error('auth.error', { event: 'delete_account', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── POST /auth/consent ────────────────────────────────────────────────────────
// Records ToS / Privacy / age consent for the authenticated user.
// This endpoint is deliberately exempt from the requireConsent guard so that
// OAuth-created accounts (which start with null consent fields) can reach it.

router.post('/consent', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { agreedTos, agreedPrivacy, agreedAge } = req.body as {
    agreedTos?: unknown
    agreedPrivacy?: unknown
    agreedAge?: unknown
  }

  if (agreedTos !== true || agreedPrivacy !== true || agreedAge !== true) {
    res.status(400).json({
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'agreedTos, agreedPrivacy, and agreedAge must all be true',
      },
    })
    return
  }

  const userId = req.userId!

  try {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { tosAcceptedAt: true, privacyAcceptedAt: true, ageConfirmedAt: true },
    })

    if (!existing) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      })
      return
    }

    const now = new Date()

    // Only set timestamps that are not yet recorded — never overwrite an existing acceptance.
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: userId },
        data: {
          tosAcceptedAt: existing.tosAcceptedAt ?? now,
          privacyAcceptedAt: existing.privacyAcceptedAt ?? now,
          ageConfirmedAt: existing.ageConfirmedAt ?? now,
        },
        select: { tosAcceptedAt: true, privacyAcceptedAt: true, ageConfirmedAt: true },
      })

      await tx.complianceAuditLog.create({
        data: {
          userId,
          resourceType: 'consent',
          resourceId: String(userId),
          action: 'ACCEPT',
          ipAddress: req.ip ?? 'unknown',
        },
      })

      return result
    })

    logger.info('auth.consent_recorded', { userId })

    res.json({
      data: {
        tosAcceptedAt: updated.tosAcceptedAt,
        privacyAcceptedAt: updated.privacyAcceptedAt,
        ageConfirmedAt: updated.ageConfirmedAt,
      },
    })
  } catch (e) {
    logger.error('auth.error', { event: 'consent', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

// ── OAuth helpers ────────────────────────────────────────────────────────────

const OTP_EXPIRY_MINUTES = 10

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { data: null, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many OTP requests. Try again in 1 hour.' } },
})

type OAuthIntent = 'login' | 'signup'

interface OAuthState {
  intent?: string
  mobileRedirectUri?: string
}

function oauthCallbackUrl(provider: 'google' | 'microsoft'): string {
  const baseUrl = (
    process.env.OAUTH_CALLBACK_BASE_URL ??
    process.env.APP_URL ??
    'https://myfuturely.ai'
  ).replace(/\/+$/, '')
  return `${baseUrl}/api/auth/oauth/${provider}/callback`
}

function readMobileRedirect(req: Request, res: Response): string | undefined | false {
  if (req.query.platform !== 'mobile') return undefined

  const redirectUri = validateMobileOAuthRedirectUri(req.query.redirectUri)
  if (!redirectUri) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REDIRECT_URI', message: 'Invalid mobile OAuth redirect URI.' },
    })
    return false
  }

  return redirectUri
}

function redirectOAuthError(
  res: Response,
  appUrl: string,
  mobileRedirectUri: string | undefined,
  code: string,
): void {
  if (mobileRedirectUri) {
    res.redirect(buildMobileOAuthRedirect(mobileRedirectUri, { error: code }))
    return
  }
  res.redirect(`${appUrl}/login?error=${encodeURIComponent(code)}`)
}

async function finishOAuth(
  res: Response,
  provider: string,
  providerId: string,
  email: string,
  name: string | undefined,
  intent: OAuthIntent,
  mobileRedirectUri?: string,
): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'https://myfuturely.ai'

  let existing = await prisma.oAuthAccount.findFirst({ where: { provider, providerId } })
  let userId: number
  let isNew = false

  if (existing) {
    userId = existing.userId
  } else {
    // Check if a user with this email already exists — link accounts
    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      // No existing account found for this identity. If the user initiated
      // OAuth from the login tab (intent === 'login'), do NOT auto-create an
      // account — redirect back to the login page carrying the verified email
      // and name so the signup form can be prefilled. No cookies, no tokens.
      if (intent === 'login') {
        if (mobileRedirectUri) {
          res.redirect(buildMobileOAuthRedirect(mobileRedirectUri, {
            error: 'OAUTH_NEEDS_SIGNUP',
          }))
          return
        }
        const nameParam = name ? `&name=${encodeURIComponent(name)}` : ''
        res.redirect(
          `${appUrl}/login?oauth=needs_signup&email=${encodeURIComponent(email)}${nameParam}`,
        )
        return
      }

      // OAuth signup never collects a date of birth (no form step — it's a
      // redirect-based provider flow), so a brand-new OAuth user cannot pass
      // the COPPA 13+ gate at creation time the way email/password signup
      // does. Fail closed: start them in DOB_MISMATCH_LOCKED (same state as
      // "no self-reported DOB on file" everywhere else in this module) so
      // requireActiveAccount blocks them until they submit a DOB via
      // PATCH /auth/dob, which enforces the same validateDobInput() 13+
      // check. Never default a new user to ACTIVE without a DOB on file.
      //
      // Connecting a school portal is NOT required to leave this state —
      // PATCH /auth/dob activates the account as soon as a valid 13+ DOB is
      // submitted, since there is no hacDateOfBirth yet to contradict it.
      // Real verification against the school's record happens later, in the
      // background, whenever (if ever) the user connects a school portal —
      // see dobVerification.ts's sync-time comparison in gradesRouter.ts,
      // which can still re-lock (mismatch) or ban (mismatch + under 13) the
      // account after the fact.

      // Guard against a unique-constraint violation on User.name: if the
      // provider-supplied display name is already taken by another account,
      // create the account with name: null rather than crashing. The user
      // can set a display name later via their profile settings. This mirrors
      // the explicit nameTaken check in the email/password /register handler,
      // but here we fall back silently to null instead of rejecting, because
      // the OAuth redirect flow has no form the user can immediately correct.
      let resolvedName: string | null = name ?? null
      if (resolvedName !== null) {
        const nameTaken = await prisma.user.findFirst({ where: { name: resolvedName }, select: { id: true } })
        if (nameTaken) {
          resolvedName = null
        }
      }

      user = await prisma.user.create({
        data: {
          email,
          passwordHash: null,
          name: resolvedName,
          emailVerified: true,
          accountStatus: AccountStatus.DOB_MISMATCH_LOCKED,
        },
      })
      isNew = true
    }
    await prisma.oAuthAccount.create({ data: { userId: user.id, provider, providerId, email } })
    userId = user.id
  }

  const [oauthUser, refreshToken, hasSchool] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, accountStatus: true } }),
    issueRefreshToken(userId),
    prisma.schoolConnection.findUnique({ where: { userId } }),
  ])
  const accessToken = issueAccessToken(userId, oauthUser?.role ?? 'STUDENT', oauthUser?.accountStatus)

  if (mobileRedirectUri) {
    res.redirect(buildMobileOAuthRedirect(mobileRedirectUri, {
      token: accessToken,
      refreshToken,
      isNew: String(isNew),
    }))
    return
  }

  setAuthCookies(res, accessToken, refreshToken)
  if (isNew) {
    res.redirect(`${appUrl}/login?oauth=new`)
  } else {
    res.redirect(`${appUrl}/dashboard${!hasSchool ? '?connect=1' : ''}`)
  }
}

// ── GET /auth/oauth/google ───────────────────────────────────────────────────
router.get('/oauth/google', (req: Request, res: Response): void => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) { res.status(500).json({ error: 'Google OAuth not configured' }); return }
  const mobileRedirectUri = readMobileRedirect(req, res)
  if (mobileRedirectUri === false) return
  const redirect = encodeURIComponent(oauthCallbackUrl('google'))
  // Accept 'login' or 'signup' intent from the frontend. Default to 'signup'
  // for any missing/unrecognised value so malformed links never silently block
  // a legitimate new-account creation (fail toward the less-restrictive path).
  const rawIntent = (req.query.intent as string | undefined) ?? ''
  const intent: OAuthIntent = rawIntent === 'login' ? 'login' : 'signup'
  const state = jwt.sign(
    { ts: Date.now(), intent, mobileRedirectUri },
    process.env.JWT_SECRET!,
    { expiresIn: '10m' },
  )
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&scope=openid%20email%20profile&state=${state}`
  res.redirect(url)
})

router.get('/oauth/google/callback', async (req: Request, res: Response): Promise<void> => {
  const appUrl = process.env.APP_URL ?? 'https://myfuturely.ai'
  let mobileRedirectUri: string | undefined
  try {
    const { code, state } = req.query as { code?: string; state?: string }
    if (!state) { redirectOAuthError(res, appUrl, undefined, 'oauth_cancelled'); return }
    const statePayload = jwt.verify(state, process.env.JWT_SECRET!) as OAuthState
    if (statePayload.mobileRedirectUri) {
      mobileRedirectUri =
        validateMobileOAuthRedirectUri(statePayload.mobileRedirectUri) ?? undefined
      if (!mobileRedirectUri) throw new Error('Invalid mobile redirect in signed OAuth state')
    }
    if (!code) { redirectOAuthError(res, appUrl, mobileRedirectUri, 'oauth_cancelled'); return }
    const intent: OAuthIntent = statePayload.intent === 'login' ? 'login' : 'signup'

    const redirect = oauthCallbackUrl('google')
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirect, grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json() as { access_token?: string; id_token?: string }
    if (!tokens.access_token) { redirectOAuthError(res, appUrl, mobileRedirectUri, 'oauth_failed'); return }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const info = await userRes.json() as { sub?: string; email?: string; name?: string }
    if (!info.sub || !info.email) { redirectOAuthError(res, appUrl, mobileRedirectUri, 'oauth_failed'); return }

    await finishOAuth(res, 'google', info.sub, info.email, info.name, intent, mobileRedirectUri)
  } catch (e) {
    logger.error('auth.error', { event: 'oauth_google_callback', error: e instanceof Error ? e.message : String(e) })
    redirectOAuthError(res, appUrl, mobileRedirectUri, 'oauth_failed')
  }
})

// ── GET /auth/oauth/microsoft ────────────────────────────────────────────────
router.get('/oauth/microsoft', (req: Request, res: Response): void => {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  if (!clientId) { res.status(500).json({ error: 'Microsoft OAuth not configured' }); return }
  const mobileRedirectUri = readMobileRedirect(req, res)
  if (mobileRedirectUri === false) return
  const redirect = encodeURIComponent(oauthCallbackUrl('microsoft'))
  // Accept 'login' or 'signup' intent from the frontend. Default to 'signup'
  // for any missing/unrecognised value so malformed links never silently block
  // a legitimate new-account creation (fail toward the less-restrictive path).
  const rawIntent = (req.query.intent as string | undefined) ?? ''
  const intent: OAuthIntent = rawIntent === 'login' ? 'login' : 'signup'
  const state = jwt.sign(
    { ts: Date.now(), intent, mobileRedirectUri },
    process.env.JWT_SECRET!,
    { expiresIn: '10m' },
  )
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&scope=openid%20email%20profile&state=${state}`
  res.redirect(url)
})

router.get('/oauth/microsoft/callback', async (req: Request, res: Response): Promise<void> => {
  const appUrl = process.env.APP_URL ?? 'https://myfuturely.ai'
  let mobileRedirectUri: string | undefined
  try {
    const { code, state } = req.query as { code?: string; state?: string }
    if (!state) { redirectOAuthError(res, appUrl, undefined, 'oauth_cancelled'); return }
    const statePayload = jwt.verify(state, process.env.JWT_SECRET!) as OAuthState
    if (statePayload.mobileRedirectUri) {
      mobileRedirectUri =
        validateMobileOAuthRedirectUri(statePayload.mobileRedirectUri) ?? undefined
      if (!mobileRedirectUri) throw new Error('Invalid mobile redirect in signed OAuth state')
    }
    if (!code) { redirectOAuthError(res, appUrl, mobileRedirectUri, 'oauth_cancelled'); return }
    const intent: OAuthIntent = statePayload.intent === 'login' ? 'login' : 'signup'

    const redirect = oauthCallbackUrl('microsoft')
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        redirect_uri: redirect, grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json() as { access_token?: string }
    if (!tokens.access_token) { redirectOAuthError(res, appUrl, mobileRedirectUri, 'oauth_failed'); return }

    const userRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,mail,displayName,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const info = await userRes.json() as { id?: string; mail?: string; userPrincipalName?: string; displayName?: string }
    const email = info.mail ?? info.userPrincipalName
    if (!info.id || !email) { redirectOAuthError(res, appUrl, mobileRedirectUri, 'oauth_failed'); return }

    await finishOAuth(res, 'microsoft', info.id, email, info.displayName, intent, mobileRedirectUri)
  } catch (e) {
    logger.error('auth.error', { event: 'oauth_microsoft_callback', error: e instanceof Error ? e.message : String(e) })
    redirectOAuthError(res, appUrl, mobileRedirectUri, 'oauth_failed')
  }
})

// ── POST /auth/send-otp ──────────────────────────────────────────────────────
router.post('/send-otp', otpLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email?: string }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Valid email required.' } })
    return
  }

  const domainValid = await hasValidMailDomain(email)
  if (!domainValid) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'That email domain doesn\'t appear to be valid.' } })
    return
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ data: null, error: { code: 'CONFLICT', message: 'An account with this email already exists.' } })
    return
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const codeHash = crypto.createHash('sha256').update(code).digest('hex')
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

  await prisma.emailOTP.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } })
  await prisma.emailOTP.create({ data: { email, codeHash, expiresAt } })

  await sendEmail({
    to: email,
    subject: 'Your myFuturely verification code',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#F0F4FF;">
        <div style="background:#fff;border-radius:16px;border:1px solid #C0CCE8;padding:36px 40px;text-align:center;">
          <div style="font-size:26px;font-weight:800;color:#050B18;margin-bottom:24px;">myFuturely</div>
          <div style="font-size:16px;font-weight:600;color:#050B18;margin-bottom:8px;">Your verification code</div>
          <div style="font-size:42px;font-weight:800;letter-spacing:10px;color:#2979FF;margin:24px 0;">${code}</div>
          <div style="font-size:13px;color:#7B8DB0;">This code expires in ${OTP_EXPIRY_MINUTES} minutes.<br>If you didn't request this, ignore this email.</div>
        </div>
      </div>
    `,
  })

  res.json({ data: { sent: true } })
})

export default router
import { safeConsole as console } from '../common/safeConsole'
