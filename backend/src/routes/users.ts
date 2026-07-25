/**
 * User settings endpoints.
 *
 * PATCH /users/me/autonomous-consent — opt in/out of autonomous AI agent features.
 * Writes autonomousConsentAcceptedAt and records a FERPA compliance audit log entry.
 *
 * Bug 10 fix: added a fail-closed COPPA/age check at the top of the handler.
 * An under-13 unverified user calling this endpoint directly (bypassing any UI)
 * must not be allowed to set autonomousConsentAcceptedAt. The check reuses the
 * same computeAge logic from agentExecution.service.ts (bugs 1-3 fixes) so the
 * fail-closed behavior is consistent across all entry points.
 */

import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { writeAuditLog } from '../lib/auditLog'
import { logger } from '../common/logger'
import { computeAge } from '../services/agent/agentExecution.service'
import { hasDevPowers } from '../middleware/requireAdmin'

const router = Router()

const AutonomousConsentSchema = z.object({
  accepted: z.boolean(),
}).strict()

// PATCH /users/me/autonomous-consent
router.patch(
  '/me/autonomous-consent',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (req.userId === undefined) {
      res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      return
    }

    const parsed = AutonomousConsentSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(422).json({
        data: null,
        error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      })
      return
    }

    const userId = req.userId

    // Bug 10 fix: fail-closed COPPA check before any DB write.
    // Under-13 unverified users cannot set autonomous consent regardless of how
    // they reach this endpoint. Unknown age (null DOB, decrypt error) is treated
    // as potentially under-13 and denied. No audit log is written on denial —
    // the request is unauthorized and there is no consent action to record.
    try {
      const userRecord = await prisma.user.findUnique({
        where: { id: userId },
        select: { dateOfBirth: true, coppaConsentStatus: true },
      })

      if (userRecord === null) {
        res.status(403).json({
          data: null,
          error: { code: 'COPPA_BLOCKED', message: 'User not found.' },
        })
        return
      }

      // DEV/ADMIN bypass: internal test accounts skip the COPPA age check.
      // The userId originates exclusively from auth middleware upstream; no
      // client-supplied header, query param, or body field is used here.
      const isDevAccount = await hasDevPowers(userId)
      if (isDevAccount) {
        await writeAuditLog({
          userId,
          resourceType: 'USER_CONSENT',
          resourceId: String(userId),
          action: 'COPPA_BYPASS_DEV_ACCOUNT',
          ipAddress: req.ip ?? 'unknown',
        })
        // Do not return — fall through to the consent-write path below.
      }

      if (!isDevAccount) {
      if (userRecord.dateOfBirth === null) {
        res.status(403).json({
          data: null,
          error: {
            code: 'COPPA_BLOCKED',
            message: 'Age cannot be determined. Parental consent is required.',
          },
        })
        return
      }

      let age: number
      try {
        age = computeAge(userRecord.dateOfBirth)
      } catch {
        // Decryption failure: treat as potentially under-13 (fail closed)
        logger.error('coppa_age_computation_error_consent', { userId })
        res.status(403).json({
          data: null,
          error: {
            code: 'COPPA_BLOCKED',
            message: 'Age verification failed. Parental consent is required.',
          },
        })
        return
      }

      const consentVerified = userRecord.coppaConsentStatus === 'VERIFIED'
      if (age < 13 && !consentVerified) {
        res.status(403).json({
          data: null,
          error: {
            code: 'COPPA_BLOCKED',
            message: 'Parental consent is required before enabling autonomous AI features for users under 13.',
          },
        })
        return
      }
      } // end if (!isDevAccount)
    } catch (err) {
      logger.error('autonomous_consent_coppa_check_error', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      })
      res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
      return
    }

    const { accepted } = parsed.data

    try {
      const now = new Date()
      const autonomousConsentAcceptedAt = accepted ? now : null

      await prisma.user.update({
        where: { id: userId },
        data: { autonomousConsentAcceptedAt },
      })

      await writeAuditLog({
        userId,
        resourceType: 'USER_CONSENT',
        resourceId: String(userId),
        action: accepted ? 'AUTONOMOUS_CONSENT_ACCEPTED' : 'AUTONOMOUS_CONSENT_REVOKED',
        ipAddress: req.ip ?? 'unknown',
      })

      logger.info('autonomous_consent_updated', {
        userId,
        accepted,
      })

      res.status(200).json({
        data: {
          autonomousConsentAcceptedAt: autonomousConsentAcceptedAt?.toISOString() ?? null,
          accepted,
        },
      })
    } catch (err) {
      logger.error('autonomous_consent_update_error', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      })
      res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
    }
  },
)

export default router
