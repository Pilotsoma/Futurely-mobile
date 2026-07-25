import { Response, NextFunction } from 'express'
import { AccountStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { liftExpiredBanIfNeeded } from '../lib/dobVerification'
import { AuthRequest } from './auth'
import { logger } from '../common/logger'
import { isSchoolConnectAllowlisted } from './schoolConnectAllowlist'

/**
 * Enforces that the authenticated user's accountStatus is ACTIVE before
 * accessing any protected data route.
 *
 * Must be chained AFTER requireAuth (needs req.userId) — chain it AFTER
 * requireConsent too, since a DOB-locked/banned account should never even
 * reach the consent check's success path in a way that implies it's usable.
 *
 * accountStatus is always read live from the DB rather than trusted from the
 * JWT — an account can be locked or auto-unbanned mid-session, well within
 * the 15-minute access token lifetime, and a stale claim must never grant
 * (or wrongly deny) access.
 *
 * Statuses:
 *   ACTIVE               -> pass through
 *   DOB_MISMATCH_LOCKED  -> 403 DOB_VERIFICATION_REQUIRED; the frontend should
 *                           route the user to correct their DOB via PATCH /auth/dob
 *   UNDER_13_BANNED      -> 403 ACCOUNT_BANNED, unless bannedUntilDate has
 *                           passed, in which case the account transitions to
 *                           DOB_MISMATCH_LOCKED here (the COPPA ban is lifted,
 *                           but the self-reported DOB that triggered it was
 *                           still false — they still owe a correction via
 *                           PATCH /auth/dob) and this request is denied with
 *                           DOB_VERIFICATION_REQUIRED, same as any other
 *                           DOB_MISMATCH_LOCKED account
 *
 * Routes exempt from this guard (must remain reachable regardless of status):
 *   GET   /auth/me             — needed to read accountStatus in the first place
 *   GET   /auth/account-status — lightweight status poll
 *   PATCH /auth/dob            — the DOB correction endpoint
 *   POST  /auth/logout, /auth/refresh, DELETE /auth/account — same rationale
 *   as requireConsent's exemptions
 * Those routes are mounted outside this middleware in app.ts, so they remain
 * exempt automatically.
 *
 * Additionally, the paths in schoolConnectAllowlist.ts bypass this check so
 * a locked account can connect a school portal. See that module for details —
 * requireConsent shares the exact same allowlist for the exact same reason.
 */
export async function requireActiveAccount(
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

  // Allow school-portal connect/login endpoints regardless of account status
  // so a locked account can reach the school portal to resolve the lock.
  // See schoolConnectAllowlist.ts.
  if (isSchoolConnectAllowlisted(req)) {
    next()
    return
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, bannedUntilDate: true },
    })

    if (!user) {
      res.status(401).json({
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      })
      return
    }

    if (user.accountStatus === AccountStatus.ACTIVE) {
      next()
      return
    }

    if (user.accountStatus === AccountStatus.UNDER_13_BANNED) {
      const lifted = await liftExpiredBanIfNeeded(userId, user.accountStatus, user.bannedUntilDate, req.ip ?? 'unknown')
      if (lifted.accountStatus === AccountStatus.DOB_MISMATCH_LOCKED) {
        // Ban period had elapsed. The COPPA ban is lifted, but the
        // self-reported DOB that caused it is still wrong, so this request is
        // still denied — same as any other locked account — until the
        // student corrects their DOB via PATCH /auth/dob.
        res.status(403).json({
          data: null,
          error: {
            code: 'DOB_VERIFICATION_REQUIRED',
            message: 'We could not verify your date of birth against your school record. Please confirm your date of birth to continue.',
          },
        })
        return
      }

      res.status(403).json({
        data: null,
        error: {
          code: 'ACCOUNT_BANNED',
          message: 'This account is temporarily restricted until the account holder turns 13.',
        },
        bannedUntilDate: user.bannedUntilDate,
      })
      return
    }

    // DOB_MISMATCH_LOCKED
    res.status(403).json({
      data: null,
      error: {
        code: 'DOB_VERIFICATION_REQUIRED',
        message: 'We could not verify your date of birth against your school record. Please confirm your date of birth to continue.',
      },
    })
  } catch (e) {
    logger.error('middleware.requireActiveAccount.error', {
      userId,
      error: e instanceof Error ? e.message : String(e),
    })
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
}
