import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'

export interface AuthRequest extends Request {
  userId?: number
}

interface AccessTokenPayload {
  sub: number
  iat: number
  exp: number
}

function touchLastSeen(userId: number) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
  prisma.user.updateMany({
    where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: fiveMinAgo } }] },
    data: { lastSeenAt: new Date() },
  }).catch(() => {})
}

// Runs on ~1% of authenticated requests — deletes rows that are already invalid anyway.
function maybeCleanExpiredTokens() {
  if (Math.random() > 0.01) return
  const now = new Date()
  prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {})
  prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {})
  prisma.emailOTP.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {})
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  // Dev bypass already injected userId — skip JWT verification
  if (req.userId !== undefined) {
    touchLastSeen(req.userId)
    next()
    return
  }

  const secret = process.env.JWT_SECRET
  if (!secret) {
    // Fail closed — misconfigured server should not accept any tokens
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Auth not configured' } })
    return
  }

  // Accept token from Authorization header (mobile) or access_token cookie (web)
  const header = req.headers.authorization
  const rawToken = header?.startsWith('Bearer ')
    ? header.slice(7)
    : (req as Request & { cookies?: Record<string, string> }).cookies?.access_token

  if (!rawToken) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    return
  }

  try {
    // algorithms whitelist explicitly rejects 'none' and prevents algorithm-confusion attacks
    const payload = jwt.verify(rawToken, secret, { algorithms: ['HS256'] }) as unknown as AccessTokenPayload
    req.userId = payload.sub
    touchLastSeen(payload.sub)
    maybeCleanExpiredTokens()
    next()
  } catch {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
  }
}
