import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { AuthRequest, requireAuth } from '../middleware/auth'
import { requireEducator } from '../middleware/requireAdmin'
import { generateUniqueInviteCode } from '../lib/inviteCode'
import { writeAuditLog } from '../lib/auditLog'
import { grantCoinsToStudent } from '../services/educatorService'
import { logger } from '../common/logger'
import { sendToUser } from '../lib/websocket'
import { formatDueDateForPreview } from '../lib/dateFormat'

const router = Router()

function parseTagArr(raw: unknown): Array<{ tag: string; tagColor: string }> {
  if (Array.isArray(raw)) return raw as Array<{ tag: string; tagColor: string }>
  try { return JSON.parse(String(raw ?? '[]')) } catch { return [] }
}

// ── POST /educator/request-role ── (requireAuth only — user is still STUDENT)
const requestRoleSchema = z.object({
  requestedRole: z.enum(['TEACHER', 'COUNSELOR']),
  institution: z.string().min(2).max(200),
})

router.post('/request-role', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = requestRoleSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const request = await prisma.educatorRoleRequest.create({
      data: {
        userId: req.userId!,
        requestedRole: parse.data.requestedRole,
        institution: parse.data.institution,
      },
    })

    // Give Teacher tag immediately on request submission regardless of approval status
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { allTags: true, tag: true },
    })
    if (user) {
      const tags = parseTagArr(user.allTags)
      if (!tags.some(t => t.tag === 'Teacher')) {
        tags.push({ tag: 'Teacher', tagColor: '#10B981' })
        const tagUpdates: Record<string, unknown> = { allTags: JSON.stringify(tags) }
        if (!user.tag || user.tag === 'Student') {
          tagUpdates.tag = 'Teacher'
          tagUpdates.tagColor = '#10B981'
        }
        await prisma.user.update({ where: { id: req.userId! }, data: tagUpdates })
      }
    }

    logger.info('educator_role_request_submitted', { userId: req.userId, requestedRole: parse.data.requestedRole })
    res.status(201).json({ data: request, error: null })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      res.status(409).json({ data: null, error: { code: 'ALREADY_SUBMITTED', message: 'Role request already submitted' } })
      return
    }
    logger.error('educator_role_request_error', { userId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to submit role request' } })
  }
})

// All routes below require educator role
router.use(requireEducator)

// ── GET /educator/me ──
router.get('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [user, request] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId! },
        select: { role: true, name: true, email: true },
      }),
      prisma.educatorRoleRequest.findFirst({
        where: { userId: req.userId! },
        orderBy: { createdAt: 'desc' },
        select: { status: true, requestedRole: true },
      }),
    ])
    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }
    res.json({ data: { role: user.role, name: user.name, email: user.email, requestStatus: request?.status ?? null, requestedRole: request?.requestedRole ?? null }, error: null })
  } catch (err: unknown) {
    logger.error('educator_me_error', { userId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch educator profile' } })
  }
})

// ── POST /educator/classrooms ──
const createClassroomSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
})

router.post('/classrooms', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = createClassroomSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const inviteCode = await generateUniqueInviteCode()
    const classroom = await prisma.classroom.create({
      data: {
        educatorId: req.userId!,
        name: parse.data.name,
        description: parse.data.description,
        inviteCode,
      },
    })
    logger.info('classroom_created', { educatorId: req.userId, classroomId: classroom.id })
    res.status(201).json({ data: classroom, error: null })
  } catch (err: unknown) {
    logger.error('classroom_create_error', { educatorId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create classroom' } })
  }
})

// ── GET /educator/classrooms ──
router.get('/classrooms', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classrooms = await prisma.classroom.findMany({
      where: { educatorId: req.userId! },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: classrooms, error: null })
  } catch (err: unknown) {
    logger.error('classroom_list_error', { educatorId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch classrooms' } })
  }
})

// ── GET /educator/classrooms/:classroomId ──
router.get('/classrooms/:classroomId', async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.classroomId)
  if (isNaN(classroomId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroomId' } })
    return
  }
  try {
    const classroom = await prisma.classroom.findUnique({
      where: { id: classroomId },
      include: {
        memberships: {
          include: { student: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        assignments: { orderBy: { dueDate: 'asc' } },
      },
    })
    if (!classroom) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Classroom not found' } })
      return
    }
    if (classroom.educatorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this classroom' } })
      return
    }
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'CLASSROOM_ROSTER',
      resourceId: classroomId.toString(),
      action: 'EDUCATOR_VIEWED_CLASS_ROSTER',
      ipAddress: req.ip ?? 'unknown',
    })
    res.json({ data: classroom, error: null })
  } catch (err: unknown) {
    logger.error('classroom_get_error', { educatorId: req.userId, classroomId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch classroom' } })
  }
})

// ── DELETE /educator/classrooms/:classroomId ──
router.delete('/classrooms/:classroomId', async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.classroomId)
  if (isNaN(classroomId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroomId' } })
    return
  }
  try {
    const classroom = await prisma.classroom.findUnique({ where: { id: classroomId }, select: { educatorId: true } })
    if (!classroom) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Classroom not found' } })
      return
    }
    if (classroom.educatorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this classroom' } })
      return
    }
    await prisma.classroom.delete({ where: { id: classroomId } })
    logger.info('classroom_deleted', { educatorId: req.userId, classroomId })
    res.json({ data: { deleted: true }, error: null })
  } catch (err: unknown) {
    logger.error('classroom_delete_error', { educatorId: req.userId, classroomId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete classroom' } })
  }
})

// ── POST /educator/classrooms/:classroomId/assignments ──
const createAssignmentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  subject: z.string().min(1).max(100),
  dueDate: z.string().datetime(),
  // Optional IANA timezone string (e.g. "America/New_York") sent by the browser
  // so the server can format notification preview dates in the educator's local
  // calendar day rather than UTC. Falls back to UTC when omitted (backward-compatible).
  timezone: z.string().min(1).optional(),
})

router.post('/classrooms/:classroomId/assignments', async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.classroomId)
  if (isNaN(classroomId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroomId' } })
    return
  }
  const parse = createAssignmentSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const classroom = await prisma.classroom.findUnique({ where: { id: classroomId }, select: { educatorId: true } })
    if (!classroom) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Classroom not found' } })
      return
    }
    if (classroom.educatorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this classroom' } })
      return
    }
    const assignment = await prisma.educatorAssignment.create({
      data: {
        classroomId,
        creatorId: req.userId!,
        title: parse.data.title,
        description: parse.data.description,
        subject: parse.data.subject,
        dueDate: new Date(parse.data.dueDate),
      },
    })
    // Notify all students in the classroom
    try {
      const memberships = await prisma.classroomMembership.findMany({
        where: { classroomId },
        select: { studentId: true },
      })
      // Use the educator's IANA timezone so the preview date matches the local
      // calendar day, not the UTC clock on the Vercel/server runtime.
      const due = formatDueDateForPreview(new Date(parse.data.dueDate), parse.data.timezone)
      await Promise.all(memberships.map(async m => {
        const notif = await prisma.notification.create({
          data: { userId: m.studentId, fromUserId: req.userId!, type: 'TEACHER_ASSIGNMENT', preview: `${parse.data.title} — due ${due}` },
          include: { sender: { select: { id: true, name: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } },
        })
        sendToUser(m.studentId, 'NOTIFICATION', notif)
      }))
    } catch { /* non-critical */ }
    logger.info('educator_assignment_created', { educatorId: req.userId, classroomId, assignmentId: assignment.id })
    res.status(201).json({ data: assignment, error: null })
  } catch (err: unknown) {
    logger.error('educator_assignment_create_error', { educatorId: req.userId, classroomId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create assignment' } })
  }
})

// ── GET /educator/classrooms/:classroomId/assignments ──
router.get('/classrooms/:classroomId/assignments', async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.classroomId)
  if (isNaN(classroomId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroomId' } })
    return
  }
  try {
    const classroom = await prisma.classroom.findUnique({ where: { id: classroomId }, select: { educatorId: true } })
    if (!classroom) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Classroom not found' } })
      return
    }
    if (classroom.educatorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this classroom' } })
      return
    }
    const assignments = await prisma.educatorAssignment.findMany({
      where: { classroomId },
      orderBy: { dueDate: 'asc' },
    })
    res.json({ data: assignments, error: null })
  } catch (err: unknown) {
    logger.error('educator_assignments_list_error', { educatorId: req.userId, classroomId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch assignments' } })
  }
})

// ── POST /educator/classrooms/:classroomId/coins ──
const grantCoinsSchema = z.object({
  studentId: z.number().int().positive(),
  coins: z.number().int().min(1).max(300),
  reason: z.string().max(200).optional(),
})

router.post('/classrooms/:classroomId/coins', async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.classroomId)
  if (isNaN(classroomId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroomId' } })
    return
  }
  const parse = grantCoinsSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  const { studentId, coins } = parse.data
  try {
    const classroom = await prisma.classroom.findUnique({ where: { id: classroomId }, select: { educatorId: true } })
    if (!classroom) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Classroom not found' } })
      return
    }
    if (classroom.educatorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this classroom' } })
      return
    }
    const membership = await prisma.classroomMembership.findUnique({
      where: { classroomId_studentId: { classroomId, studentId } },
    })
    if (!membership) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Student is not in this classroom' } })
      return
    }
    await grantCoinsToStudent(req.userId!, studentId, coins)
    logger.info('coins_granted', { educatorId: req.userId, studentId, coins, classroomId })
    res.json({ data: { granted: true, coins }, error: null })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'COIN_CAP_EXCEEDED') {
      res.status(422).json({ data: null, error: { code: 'COIN_CAP_EXCEEDED', message: 'Daily coin limit of 300 reached for this student.' } })
      return
    }
    logger.error('coins_grant_error', { educatorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to grant coins' } })
  }
})

// ── GET /educator/classrooms/:classroomId/students/:studentId ──
router.get('/classrooms/:classroomId/students/:studentId', async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.classroomId)
  const studentId = parseInt(req.params.studentId)
  if (isNaN(classroomId) || isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroomId or studentId' } })
    return
  }
  try {
    const classroom = await prisma.classroom.findUnique({ where: { id: classroomId }, select: { educatorId: true } })
    if (!classroom) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Classroom not found' } })
      return
    }
    if (classroom.educatorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this classroom' } })
      return
    }
    const membership = await prisma.classroomMembership.findUnique({
      where: { classroomId_studentId: { classroomId, studentId } },
    })
    if (!membership) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Student is not in this classroom' } })
      return
    }
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        profile: true,
        courses: {
          include: { grades: { where: { gradingPeriod: 'CURRENT' }, take: 1 } },
          orderBy: { period: 'asc' },
        },
      },
    })
    if (!student) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Student not found' } })
      return
    }
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'STUDENT_PROFILE',
      resourceId: studentId.toString(),
      action: 'EDUCATOR_VIEWED_STUDENT',
      ipAddress: req.ip ?? 'unknown',
    })
    res.json({ data: student, error: null })
  } catch (err: unknown) {
    logger.error('educator_student_view_error', { educatorId: req.userId, classroomId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch student data' } })
  }
})

export default router
