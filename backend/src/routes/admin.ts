import { Router, Response } from 'express'
import { z } from 'zod'
import { AccountStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../middleware/auth'
import { requireAdmin } from '../middleware/requireAdmin'
import { writeAuditLog } from '../lib/auditLog'
import { logger } from '../common/logger'

const router = Router()
router.use(requireAdmin)

function parseTagArr(raw: unknown): Array<{ tag: string; tagColor: string }> {
  if (Array.isArray(raw)) return raw as Array<{ tag: string; tagColor: string }>
  try { return JSON.parse(String(raw ?? '[]')) } catch { return [] }
}

// ── GET /admin/users/:id — look up any user by Futurely ID ──
router.get('/users/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid user ID' }); return }
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, hacName: true, email: true, role: true,
        tag: true, tagColor: true, nameColor: true, avatarEffect: true,
        coins: true, loginStreak: true,
        chatBanned: true, marketplaceBanned: true, marketplaceAccess: true,
        deletedAt: true, createdAt: true, lastSeenAt: true,
      },
    })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    res.json({ data: user })
  } catch (err) {
    res.status(500).json({ error: 'Failed to look up user' })
  }
})

// ── GET /admin/educator-requests ──
const listRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'DENIED', 'ALL']).optional().default('PENDING'),
})

router.get('/educator-requests', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = listRequestsQuerySchema.safeParse(req.query)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid query' } })
    return
  }
  const { status } = parse.data
  try {
    const requests = await prisma.educatorRoleRequest.findMany({
      where: status === 'ALL' ? {} : { status },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: requests, error: null })
  } catch (err: unknown) {
    logger.error('admin_educator_requests_list_error', { adminId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch educator requests' } })
  }
})

// ── POST /admin/educator-requests/:id/approve ──
router.post('/educator-requests/:id/approve', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  try {
    const request = await prisma.educatorRoleRequest.findUnique({ where: { id } })
    if (!request) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Educator role request not found' } })
      return
    }
    if (request.status !== 'PENDING') {
      res.status(409).json({ data: null, error: { code: 'ALREADY_REVIEWED', message: 'Request has already been reviewed' } })
      return
    }
    const updated = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.educatorRoleRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedBy: req.userId!,
          reviewedAt: new Date(),
        },
      })
      await tx.user.update({
        where: { id: request.userId },
        data: { role: request.requestedRole },
      })

      // If approving a counselor, also grant the Counselor display tag
      if (request.requestedRole === 'COUNSELOR') {
        const targetUser = await tx.user.findUnique({
          where: { id: request.userId },
          select: { allTags: true, tag: true },
        })
        if (targetUser) {
          const tags = parseTagArr(targetUser.allTags)
          if (!tags.some(t => t.tag === 'Counselor')) {
            tags.push({ tag: 'Counselor', tagColor: '#8B5CF6' })
            const tagUpdates: Record<string, unknown> = { allTags: JSON.stringify(tags) }
            if (!targetUser.tag || targetUser.tag === 'Student' || targetUser.tag === 'Teacher') {
              tagUpdates.tag = 'Counselor'
              tagUpdates.tagColor = '#8B5CF6'
            }
            await tx.user.update({ where: { id: request.userId }, data: tagUpdates })
          }
        }
      }

      await tx.complianceAuditLog.create({
        data: {
          userId: req.userId!,
          resourceType: 'USER_ROLE',
          resourceId: request.userId.toString(),
          action: 'ROLE_GRANTED',
          ipAddress: req.ip ?? 'unknown',
        },
      })
      return updatedRequest
    })
    logger.info('educator_request_approved', { adminId: req.userId, requestId: id, targetUserId: request.userId, role: request.requestedRole })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('admin_approve_educator_request_error', { adminId: req.userId, requestId: id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to approve request' } })
  }
})

// ── POST /admin/educator-requests/:id/deny ──
router.post('/educator-requests/:id/deny', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  try {
    const request = await prisma.educatorRoleRequest.findUnique({ where: { id } })
    if (!request) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Educator role request not found' } })
      return
    }
    if (request.status !== 'PENDING') {
      res.status(409).json({ data: null, error: { code: 'ALREADY_REVIEWED', message: 'Request has already been reviewed' } })
      return
    }
    const updated = await prisma.educatorRoleRequest.update({
      where: { id },
      data: {
        status: 'DENIED',
        reviewedBy: req.userId!,
        reviewedAt: new Date(),
      },
    })
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'USER_ROLE',
      resourceId: request.userId.toString(),
      action: 'ROLE_DENIED',
      ipAddress: req.ip ?? 'unknown',
    })
    logger.info('educator_request_denied', { adminId: req.userId, requestId: id, targetUserId: request.userId })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('admin_deny_educator_request_error', { adminId: req.userId, requestId: id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to deny request' } })
  }
})

// ── POST /admin/educator-requests/:id/revoke ──
// Revokes an APPROVED educator — strips role, deletes all their educator data, moves to DENIED tab
router.post('/educator-requests/:id/revoke', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  try {
    const request = await prisma.educatorRoleRequest.findUnique({ where: { id } })
    if (!request) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Educator role request not found' } })
      return
    }
    if (request.status !== 'APPROVED') {
      res.status(409).json({ data: null, error: { code: 'INVALID_STATE', message: 'Request is not currently approved' } })
      return
    }
    const userId = request.userId
    const updated = await prisma.$transaction(async (tx) => {
      // Delete all educator-created data
      await tx.classroom.deleteMany({ where: { educatorId: userId } }) // cascades memberships + assignments
      await tx.educatorCoinGrant.deleteMany({ where: { educatorId: userId } })
      await tx.counselorStudentLink.deleteMany({ where: { counselorId: userId } })
      await tx.counselorCourseRecommendation.deleteMany({ where: { counselorId: userId } })
      await tx.counselorNote.deleteMany({ where: { counselorId: userId } })
      await tx.counselorActionItem.deleteMany({ where: { counselorId: userId } })
      await tx.counselorCourseComment.deleteMany({ where: { counselorId: userId } })
      await tx.counselorChatMessage.deleteMany({ where: { counselorId: userId } })

      // Strip educator tags
      const targetUser = await tx.user.findUnique({ where: { id: userId }, select: { allTags: true, tag: true, tagColor: true } })
      if (targetUser) {
        const tags = parseTagArr(targetUser.allTags).filter(t => t.tag !== 'Teacher' && t.tag !== 'Counselor')
        const isEducatorPrimary = targetUser.tag === 'Teacher' || targetUser.tag === 'Counselor'
        await tx.user.update({
          where: { id: userId },
          data: {
            role: 'STUDENT',
            allTags: JSON.stringify(tags),
            ...(isEducatorPrimary ? { tag: 'Student', tagColor: '#6B7280' } : {}),
          },
        })
      } else {
        await tx.user.update({ where: { id: userId }, data: { role: 'STUDENT' } })
      }

      const updatedRequest = await tx.educatorRoleRequest.update({
        where: { id },
        data: { status: 'DENIED', reviewedBy: req.userId!, reviewedAt: new Date() },
      })
      await tx.complianceAuditLog.create({
        data: {
          userId: req.userId!,
          resourceType: 'USER_ROLE',
          resourceId: userId.toString(),
          action: 'ROLE_REVOKED',
          ipAddress: req.ip ?? 'unknown',
        },
      })
      return updatedRequest
    })
    logger.info('educator_access_revoked', { adminId: req.userId, requestId: id, targetUserId: userId })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('admin_revoke_educator_error', { adminId: req.userId, requestId: id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke access' } })
  }
})

// ── POST /admin/educator-requests/:id/reinstate ──
// Reinstates a DENIED educator — restores role and tags
router.post('/educator-requests/:id/reinstate', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  try {
    const request = await prisma.educatorRoleRequest.findUnique({ where: { id } })
    if (!request) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Educator role request not found' } })
      return
    }
    if (request.status !== 'DENIED') {
      res.status(409).json({ data: null, error: { code: 'INVALID_STATE', message: 'Request is not currently denied' } })
      return
    }
    const userId = request.userId
    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role: request.requestedRole } })

      // Re-grant appropriate tags
      const targetUser = await tx.user.findUnique({ where: { id: userId }, select: { allTags: true, tag: true } })
      if (targetUser) {
        const tags = parseTagArr(targetUser.allTags)
        const tagName = request.requestedRole === 'COUNSELOR' ? 'Counselor' : 'Teacher'
        const tagColor = request.requestedRole === 'COUNSELOR' ? '#8B5CF6' : '#10B981'
        if (!tags.some(t => t.tag === tagName)) tags.push({ tag: tagName, tagColor })
        const isStudentPrimary = !targetUser.tag || targetUser.tag === 'Student'
        await tx.user.update({
          where: { id: userId },
          data: {
            allTags: JSON.stringify(tags),
            ...(isStudentPrimary ? { tag: tagName, tagColor } : {}),
          },
        })
      }

      const updatedRequest = await tx.educatorRoleRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewedBy: req.userId!, reviewedAt: new Date() },
      })
      await tx.complianceAuditLog.create({
        data: {
          userId: req.userId!,
          resourceType: 'USER_ROLE',
          resourceId: userId.toString(),
          action: 'ROLE_REINSTATED',
          ipAddress: req.ip ?? 'unknown',
        },
      })
      return updatedRequest
    })
    logger.info('educator_access_reinstated', { adminId: req.userId, requestId: id, targetUserId: userId })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('admin_reinstate_educator_error', { adminId: req.userId, requestId: id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to reinstate access' } })
  }
})

// ── POST /admin/grant-market-access ──
const grantMarketAccessSchema = z.object({
  userId: z.number().int().positive(),
})

router.post('/grant-market-access', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = grantMarketAccessSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  const { userId } = parse.data
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }
    await prisma.user.update({ where: { id: userId }, data: { marketplaceAccess: true } })
    logger.info('admin_market_access_granted', { adminId: req.userId, targetUserId: userId })
    res.json({ data: { ok: true }, error: null })
  } catch (err: unknown) {
    logger.error('admin_grant_market_access_error', { adminId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to grant market access' } })
  }
})

// ── POST /admin/ban-marketplace ──
const banMarketplaceSchema = z.object({
  userId: z.number().int().positive(),
  banned: z.boolean(),
})

router.post('/ban-marketplace', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = banMarketplaceSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  const { userId, banned } = parse.data
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }
    await prisma.user.update({ where: { id: userId }, data: { marketplaceBanned: banned } })
    logger.info('admin_marketplace_ban', { adminId: req.userId, targetUserId: userId, banned })
    res.json({ data: { ok: true }, error: null })
  } catch (err: unknown) {
    logger.error('admin_marketplace_ban_error', { adminId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update marketplace ban' } })
  }
})

// ── DOB verification lock — DEV/admin recovery tools ──────────────────────────
// A DOB_MISMATCH_LOCKED or UNDER_13_BANNED account that has exhausted its
// correction attempts (CORRECTION_ATTEMPTS_EXHAUSTED) has no self-service way
// out — PATCH /auth/dob's error message points them to support, but until
// now there was no actual tooling behind that. These three endpoints are that
// tooling. Never expose the raw dateOfBirth/hacDateOfBirth ciphertext values
// here — only derived status fields, matching every other DOB-related
// endpoint in this codebase.

// ── GET /admin/users/:id/dob-status ──
router.get('/users/:id/dob-status', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID' } }); return }
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { accountStatus: true, dobCorrectionAttempts: true, bannedUntilDate: true, hacDateOfBirth: true },
    })
    if (!user) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } }); return }
    res.json({
      data: {
        accountStatus: user.accountStatus,
        dobCorrectionAttempts: user.dobCorrectionAttempts,
        bannedUntilDate: user.bannedUntilDate,
        hasSchoolRecord: user.hacDateOfBirth !== null,
      },
    })
  } catch (err: unknown) {
    logger.error('admin_dob_status_error', { adminId: req.userId, targetUserId: id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to look up DOB status' } })
  }
})

// ── POST /admin/reset-dob-attempts ──
// Resets the correction-attempt counter to 0 without changing accountStatus
// or bypassing verification — the user still has to enter a birthday that
// actually matches their school record (or, if no school is connected yet,
// a valid 13+ birthday). Use this first; it's the safe option.
const resetDobAttemptsSchema = z.object({ userId: z.number().int().positive() })

router.post('/reset-dob-attempts', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = resetDobAttemptsSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  const { userId } = parse.data
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, accountStatus: true } })
    if (!user) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } }); return }

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { dobCorrectionAttempts: 0 },
        select: { accountStatus: true, dobCorrectionAttempts: true },
      }),
      prisma.complianceAuditLog.create({
        data: {
          userId,
          resourceType: 'user_identity',
          resourceId: String(userId),
          action: 'DOB_ATTEMPTS_RESET_BY_ADMIN',
          ipAddress: req.ip ?? 'unknown',
        },
      }),
    ])
    logger.info('admin_dob_attempts_reset', { adminId: req.userId, targetUserId: userId })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('admin_reset_dob_attempts_error', { adminId: req.userId, targetUserId: userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to reset DOB attempts' } })
  }
})

// ── POST /admin/force-activate-account ──
// Danger zone: bypasses DOB verification entirely and forces the account
// ACTIVE, clearing any ban. For genuine false positives only (e.g. a wrong
// birthdate on the school's own portal) — this does not re-check anything,
// it just overrides. Always audited.
const forceActivateSchema = z.object({ userId: z.number().int().positive() })

router.post('/force-activate-account', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = forceActivateSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  const { userId } = parse.data
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } }); return }

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { accountStatus: AccountStatus.ACTIVE, bannedUntilDate: null, dobCorrectionAttempts: 0 },
        select: { accountStatus: true, bannedUntilDate: true, dobCorrectionAttempts: true },
      }),
      prisma.complianceAuditLog.create({
        data: {
          userId,
          resourceType: 'user_identity',
          resourceId: String(userId),
          action: 'ACCOUNT_FORCE_ACTIVATED_BY_ADMIN',
          ipAddress: req.ip ?? 'unknown',
        },
      }),
    ])
    logger.info('admin_account_force_activated', { adminId: req.userId, targetUserId: userId })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('admin_force_activate_error', { adminId: req.userId, targetUserId: userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to activate account' } })
  }
})

export default router
