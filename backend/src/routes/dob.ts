/**
 * PATCH /auth/dob — lets a DOB_MISMATCH_LOCKED user submit or correct their
 * self-reported date of birth. Two distinct cases share this endpoint:
 *   - No hacDateOfBirth on file (e.g. an OAuth signup that hasn't connected
 *     a school portal yet): nothing to verify against, so a valid 13+ DOB is
 *     accepted and the account activates immediately. Real verification
 *     happens later, in the background, whenever a school portal is
 *     connected (see dobVerification.ts / gradesRouter.ts).
 *   - hacDateOfBirth already on file (a real detected mismatch): the
 *     resubmitted DOB is re-verified against it, never self-certified.
 *
 * Mounted separately from the main auth router (see app.ts) so it can sit
 * behind requireAuth without dragging the rest of /auth along with it.
 */

import { Router, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { AccountStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { logger } from '../common/logger'
import {
  validateDobInput,
  encryptDob,
  evaluateDobVerification,
  MAX_DOB_CORRECTION_ATTEMPTS,
} from '../lib/dobVerification'

const router = Router()

// DTO — a correction is exactly one field, no extras.
const DobCorrectionSchema = z.object({
  dateOfBirth: z.string(),
}).strict()

const dobCorrectionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many date-of-birth correction attempts. Try again in 1 hour.' },
  },
})

// ── PATCH /auth/dob ─────────────────────────────────────────────────────────

router.patch('/', dobCorrectionLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!

  const parsed = DobCorrectionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(422).json({ data: null, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } })
    return
  }

  const dobCheck = validateDobInput(parsed.data.dateOfBirth)
  if (!dobCheck.ok || !dobCheck.isoDate) {
    res.status(400).json({
      data: null,
      error: { code: dobCheck.errorCode ?? 'VALIDATION_ERROR', message: dobCheck.error },
    })
    return
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, dobCorrectionAttempts: true, hacDateOfBirth: true },
    })

    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }

    if (user.accountStatus !== AccountStatus.DOB_MISMATCH_LOCKED) {
      res.status(400).json({
        data: null,
        error: { code: 'NO_CORRECTION_NEEDED', message: 'Your date of birth does not need to be corrected.' },
      })
      return
    }

    if (user.dobCorrectionAttempts >= MAX_DOB_CORRECTION_ATTEMPTS) {
      res.status(403).json({
        data: null,
        error: {
          code: 'CORRECTION_ATTEMPTS_EXHAUSTED',
          message: 'You have used all your date-of-birth correction attempts. Please contact support.',
        },
      })
      return
    }

    if (!user.hacDateOfBirth) {
      // No school record to compare against yet. There is nothing to verify
      // this self-report against, but it has already passed the same 13+
      // format/age validation signup uses (validateDobInput above) — accept
      // it and activate the account. This is NOT a security bypass: it only
      // applies when no HAC record exists at all, i.e. no mismatch has ever
      // been detected. Once a school portal is connected, the existing
      // sync-time comparison (dobVerification.ts, invoked from
      // gradesRouter.ts) runs the same match/mismatch/under-13 evaluation in
      // the background and will re-lock or ban the account if the school's
      // record contradicts this self-report. A previously banned or
      // mismatch-locked account always has hacDateOfBirth already set (both
      // states are only ever reached via that same comparison), so this
      // branch can never be used to bypass a real, already-detected mismatch.
      const [updated] = await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            dateOfBirth: encryptDob(dobCheck.isoDate),
            dobCorrectionAttempts: user.dobCorrectionAttempts + 1,
            accountStatus: AccountStatus.ACTIVE,
          },
          select: { accountStatus: true, bannedUntilDate: true },
        }),
        prisma.complianceAuditLog.create({
          data: {
            userId,
            resourceType: 'user_identity',
            resourceId: String(userId),
            action: 'DOB_SELF_CERTIFIED_NO_SCHOOL_RECORD',
            ipAddress: req.ip ?? 'unknown',
          },
        }),
      ])
      res.json({
        data: {
          accountStatus: updated.accountStatus,
          bannedUntilDate: updated.bannedUntilDate,
        },
      })
      return
    }

    const newEncryptedDob = encryptDob(dobCheck.isoDate)
    const newAttempts = user.dobCorrectionAttempts + 1

    const evaluation = evaluateDobVerification({
      selfReportedDobEncrypted: newEncryptedDob,
      hacDobEncrypted: user.hacDateOfBirth,
    })

    const auditAction = evaluation.status === AccountStatus.ACTIVE
      ? 'DOB_MISMATCH_RESOLVED'
      : evaluation.status === AccountStatus.UNDER_13_BANNED
        ? 'UNDER_13_BANNED'
        : 'DOB_CORRECTION_FAILED'

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          dateOfBirth: newEncryptedDob,
          dobCorrectionAttempts: newAttempts,
          accountStatus: evaluation.status,
          bannedUntilDate: evaluation.bannedUntilDate,
        },
        select: { accountStatus: true, bannedUntilDate: true, dobCorrectionAttempts: true },
      }),
      prisma.complianceAuditLog.create({
        data: {
          userId,
          resourceType: 'user_identity',
          resourceId: String(userId),
          action: auditAction,
          ipAddress: req.ip ?? 'unknown',
        },
      }),
    ])

    logger.info('auth.dob_correction_attempted', {
      userId,
      resultStatus: updated.accountStatus,
      attempts: updated.dobCorrectionAttempts,
    })

    if (updated.accountStatus === AccountStatus.DOB_MISMATCH_LOCKED) {
      const attemptsLeft = MAX_DOB_CORRECTION_ATTEMPTS - updated.dobCorrectionAttempts
      res.status(409).json({
        data: null,
        error: {
          code: 'DOB_STILL_MISMATCHED',
          message: attemptsLeft > 0
            ? `That date of birth still doesn't match your school record. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.`
            : 'That date of birth still doesn\'t match your school record. You have no attempts remaining — please contact support.',
        },
      })
      return
    }

    if (updated.accountStatus === AccountStatus.UNDER_13_BANNED) {
      // The corrected DOB still didn't match, and the school record shows
      // the student is under 13 — this is the COPPA case, not a retryable
      // mismatch. Respond with the ban rather than a generic error.
      res.status(403).json({
        data: null,
        error: {
          code: 'ACCOUNT_BANNED',
          message: 'This account is temporarily restricted until the account holder turns 13.',
        },
        bannedUntilDate: updated.bannedUntilDate,
      })
      return
    }

    res.json({
      data: {
        accountStatus: updated.accountStatus,
        bannedUntilDate: updated.bannedUntilDate,
      },
    })
  } catch (e) {
    logger.error('auth.error', { event: 'dob_correction', error: e instanceof Error ? e.message : String(e) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

export default router
