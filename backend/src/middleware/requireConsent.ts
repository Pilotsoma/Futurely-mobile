import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from './auth'
import { logger } from '../common/logger'
import { isSchoolConnectAllowlisted } from './schoolConnectAllowlist'

/**
 * Enforces that the authenticated user has accepted ToS, Privacy Policy, and
 * confirmed their age before accessing any protected resource.
 *
 * Must be chained AFTER requireAuth so that req.userId is guaranteed to be set.
 *
 * Routes exempt from this guard (must remain reachable regardless of consent):
 *   POST /auth/consent     — the endpoint that records acceptance
 *   GET  /auth/me          — needed by the frontend to seed user state after OAuth
 *   POST /auth/logout      — users must always be able to log out
 *   POST /auth/refresh     — session refresh must never be blocked
 *   DELETE /auth/account   — users must always be able to delete their account
 *
 * Those routes are mounted inside auth.ts which is NOT wrapped with this
 * middleware in app.ts, so they remain exempt automatically.
 *
 * Additionally, the paths in schoolConnectAllowlist.ts bypass this check —
 * a fresh OAuth account has neither recorded consent nor a school connection,
 * and connecting a school portal is the only way out of DOB_MISMATCH_LOCKED.
 * requireActiveAccount shares the exact same allowlist for the exact same
 * reason; without this, a locked, unconsented account's connect request was
 * silently rejected here (this middleware runs before requireActiveAccount,
 * so the earlier fix there was never enough on its own), bouncing the user
 * to the consent modal and discarding the school credentials they'd just
 * entered — so after agreeing to the ToS, they had to enter their school
 * portal credentials a second time.
 */
export async function requireConsent(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.userId

  // Fail closed: requireAuth should have blocked this earlier, but guard anyway.
  if (userId === undefined) {
    res.status(401).json({
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    })
    return
  }

  // Allow school-portal connect/login endpoints regardless of consent status
  // so a locked, unconsented account can reach the school portal to resolve
  // the lock. See schoolConnectAllowlist.ts.
  if (isSchoolConnectAllowlisted(req)) {
    next()
    return
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tosAcceptedAt: true, privacyAcceptedAt: true, ageConfirmedAt: true },
    })

    if (
      !user ||
      user.tosAcceptedAt === null ||
      user.privacyAcceptedAt === null ||
      user.ageConfirmedAt === null
    ) {
      res.status(403).json({
        data: null,
        error: {
          code: 'CONSENT_REQUIRED',
          message:
            'You must accept the Terms of Service, Privacy Policy, and confirm your age to continue.',
        },
      })
      return
    }

    next()
  } catch (e) {
    logger.error('middleware.requireConsent.error', {
      userId,
      error: e instanceof Error ? e.message : String(e),
    })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
}
