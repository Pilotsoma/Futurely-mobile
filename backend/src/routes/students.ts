import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { ASSIGNMENT_SOURCE } from '../constants/assignmentSource'
import { writeAuditLog } from '../lib/auditLog'
import { supabaseAdmin } from '../lib/supabaseAdmin'
import { logger } from '../common/logger'
import { sendToUser } from '../lib/websocket'

const router = Router()

const STREAK_MILESTONES: Array<{ days: number; tag: string; tagColor: string }> = [
  { days: 7,   tag: 'Novice',   tagColor: '#22C55E' },
  { days: 14,  tag: 'Pro',      tagColor: '#3B82F6' },
  { days: 30,  tag: 'Veteran',  tagColor: '#F97316' },
  { days: 50,  tag: 'Legend',   tagColor: '#EC4899' },
  { days: 100, tag: 'GOAT',     tagColor: '#EAB308' },
]

function parseAllTags(raw: unknown): Array<{ tag: string; tagColor: string }> {
  if (Array.isArray(raw)) return (raw as Array<{ tag?: unknown; tagColor?: unknown }>)
    .filter(t => t?.tag).map(t => ({ tag: String(t.tag), tagColor: String(t.tagColor ?? 'grey') }))
  try { return JSON.parse(String(raw ?? '[]')) as Array<{ tag: string; tagColor: string }> } catch { return [] }
}

function letterToPoints(letter: string): number {
  const map: Record<string, number> = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7,
    'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7,
    'D+': 1.3, 'D': 1.0, 'D-': 0.7,
    'F':  0.0,
  }
  return map[letter.trim().toUpperCase()] ?? 0.0
}

function weightedBonus(courseType: string): number {
  const t = courseType.toUpperCase()
  if (t.includes('AP') || t.includes('IB')) return 1.0
  if (t.includes('HONOR') || t.includes('DUAL')) return 0.5
  return 0.0
}

function computeGpa(courses: Array<{ courseType: string; grades: Array<{ letterGrade: string }> }>): { unweighted: number; weighted: number } {
  const graded = courses.filter(c => c.grades.length > 0)
  if (graded.length === 0) return { unweighted: 0, weighted: 0 }
  let uSum = 0, wSum = 0
  for (const c of graded) {
    const pts = letterToPoints(c.grades[0].letterGrade)
    uSum += pts
    wSum += Math.min(pts + weightedBonus(c.courseType), 5.0)
  }
  const n = graded.length
  return {
    unweighted: Math.round((uSum / n) * 1000) / 1000,
    weighted:   Math.round((wSum / n) * 1000) / 1000,
  }
}

router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userId === undefined) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    return
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: {
        profile: true,
        courses: {
          include: {
            grades: { where: { gradingPeriod: 'CURRENT' }, take: 1 },
          },
          orderBy: { period: 'asc' },
        },
        assignments: {
          where: { source: { notIn: [ASSIGNMENT_SOURCE.SEED, ASSIGNMENT_SOURCE.HAC] } },
          orderBy: { dueDate: 'asc' },
        },
      },
    })

    if (!user) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart.getTime() + 86400000)
    const weekEnd = new Date(todayStart.getTime() + 7 * 86400000)

    const stats = {
      totalCourses: user.courses.length,
      completedAssignments: user.assignments.filter(a => a.completed).length,
      pendingAssignments: user.assignments.filter(a => !a.completed).length,
      assignmentsDueToday: user.assignments.filter(
        a => !a.completed && a.dueDate >= todayStart && a.dueDate < todayEnd
      ).length,
      assignmentsDueThisWeek: user.assignments.filter(
        a => !a.completed && a.dueDate >= todayStart && a.dueDate < weekEnd
      ).length,
    }

    const courses = user.courses.map(c => {
      const g = c.grades[0] ?? null
      return {
        id: c.id,
        name: c.name,
        teacher: c.teacher,
        period: c.period,
        courseType: c.courseType,
        creditHours: c.creditHours,
        semester: c.semester,
        grade: g ? { letterGrade: g.letterGrade, percentage: g.percentage } : null,
      }
    })

    const { unweighted, weighted } = computeGpa(user.courses)

    res.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        hasPassword: !!user.passwordHash,
        profile: user.profile
          ? { ...user.profile, unweightedGpa: unweighted, weightedGpa: weighted }
          : null,
        courses,
        assignments: user.assignments,
        stats,
      },
    })
  } catch {
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

const patchProfileSchema = z.object({
  satScore: z.number().int().min(400).max(1600).nullable().optional(),
  actScore: z.number().int().min(1).max(36).nullable().optional(),
  futureDecision: z.string().max(500).nullable().optional(),
})

router.patch('/me/profile', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }); return }

  const parse = patchProfileSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request body' } })
    return
  }

  const { satScore, actScore, futureDecision } = parse.data

  try {
    const profile = await prisma.profile.upsert({
      where: { userId: req.userId },
      create: {
        userId: req.userId,
        ...(satScore !== undefined && { satScore: satScore ?? null }),
        ...(actScore !== undefined && { actScore: actScore ?? null }),
        ...(futureDecision !== undefined && { futureDecision: futureDecision ?? null }),
      },
      update: {
        ...(satScore !== undefined && { satScore: satScore ?? null }),
        ...(actScore !== undefined && { actScore: actScore ?? null }),
        ...(futureDecision !== undefined && { futureDecision: futureDecision ?? null }),
      },
    })
    await writeAuditLog({
      userId: req.userId,
      resourceType: 'STUDENT_PROFILE',
      resourceId: String(req.userId),
      action: 'PROFILE_UPDATED',
      ipAddress: req.ip ?? 'unknown',
    })
    logger.info('student_profile_updated', { userId: req.userId })
    res.json({ data: profile })
  } catch (err: unknown) {
    logger.error('student_profile_update_error', { userId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update profile' } })
  }
})

router.patch('/me/avatar', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } })
    if (user?.role !== 'ADMIN') { res.status(403).json({ error: 'DEV only' }); return }
    const { avatarUrl } = req.body as { avatarUrl: string | null }
    if (avatarUrl !== null && avatarUrl !== undefined) {
      try {
        const parsed = new URL(avatarUrl)
        if (parsed.protocol !== 'https:') {
          res.status(400).json({ error: 'avatarUrl must use https://' }); return
        }
      } catch {
        res.status(400).json({ error: 'avatarUrl must be a valid URL' }); return
      }
    }
    const updated = await prisma.user.update({ where: { id: req.userId }, data: { avatarUrl: avatarUrl ?? null }, select: { avatarUrl: true } })
    res.json({ data: updated })
  } catch {
    res.status(500).json({ error: 'Failed to update avatar' })
  }
})

router.post('/me/streak-reward', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }); return }
  const { streak } = req.body as { streak?: number }
  if (typeof streak !== 'number' || streak < 1) {
    res.status(400).json({ data: null, error: { code: 'BAD_REQUEST', message: 'streak must be a positive number' } })
    return
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { allTags: true } })
    const existing = parseAllTags(user?.allTags)
    const existingNames = new Set(existing.map(t => t.tag))

    const newlyEarned = STREAK_MILESTONES.filter(m => streak >= m.days && !existingNames.has(m.tag))
    if (newlyEarned.length === 0) {
      res.json({ data: { newTags: [] } })
      return
    }

    const updated = [...existing, ...newlyEarned.map(m => ({ tag: m.tag, tagColor: m.tagColor }))]
    await prisma.user.update({
      where: { id: req.userId },
      data: { allTags: JSON.stringify(updated) },
    })

    res.json({ data: { newTags: newlyEarned } })
  } catch {
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to award streak tag' } })
  }
})

// ── POST /students/classrooms/join ──
const joinClassroomSchema = z.object({
  inviteCode: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
})

router.post('/classrooms/join', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  const parse = joinClassroomSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid invite code' } })
    return
  }
  try {
    const classroom = await prisma.classroom.findUnique({ where: { inviteCode: parse.data.inviteCode } })
    if (!classroom) {
      res.status(404).json({ data: null, error: { code: 'CLASSROOM_NOT_FOUND', message: 'Classroom not found' } })
      return
    }
    const existing = await prisma.classroomMembership.findUnique({
      where: { classroomId_studentId: { classroomId: classroom.id, studentId: req.userId } },
    })
    if (existing) {
      res.status(409).json({ data: null, error: { code: 'ALREADY_MEMBER', message: 'You are already a member of this classroom' } })
      return
    }
    const membership = await prisma.classroomMembership.create({
      data: { classroomId: classroom.id, studentId: req.userId },
    })
    await writeAuditLog({
      userId: req.userId,
      resourceType: 'CLASSROOM_MEMBERSHIP',
      resourceId: classroom.educatorId.toString(),
      action: 'EDUCATOR_ACCESS_CONSENTED',
      ipAddress: req.ip ?? 'unknown',
    })
    try {
      const notif = await prisma.notification.create({
        data: { userId: req.userId, fromUserId: classroom.educatorId, type: 'CLASSROOM_JOINED', preview: classroom.name },
        include: { sender: { select: { id: true, name: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } },
      })
      sendToUser(req.userId, 'NOTIFICATION', notif)
    } catch { /* non-critical */ }
    logger.info('student_joined_classroom', { studentId: req.userId, classroomId: classroom.id })
    res.status(201).json({ data: membership, error: null })
  } catch (err: unknown) {
    logger.error('student_join_classroom_error', { studentId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to join classroom' } })
  }
})

// ── GET /students/classrooms ──
router.get('/classrooms', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  try {
    const memberships = await prisma.classroomMembership.findMany({
      where: { studentId: req.userId },
      include: {
        classroom: {
          include: { educator: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { joinedAt: 'asc' },
    })
    res.json({ data: memberships.map(m => m.classroom), error: null })
  } catch (err: unknown) {
    logger.error('student_classrooms_list_error', { studentId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch classrooms' } })
  }
})

// ── GET /students/classrooms/:id ──
router.get('/classrooms/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.id)
  if (isNaN(classroomId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroom id' } })
    return
  }
  try {
    // Verify the student is actually a member
    const membership = await prisma.classroomMembership.findUnique({
      where: { classroomId_studentId: { classroomId, studentId: req.userId! } },
    })
    if (!membership) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You are not a member of this classroom' } })
      return
    }
    const classroom = await prisma.classroom.findUnique({
      where: { id: classroomId },
      include: {
        educator: { select: { id: true, name: true, email: true } },
        assignments: { orderBy: { dueDate: 'asc' } },
        memberships: {
          include: { student: { select: { id: true, name: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    })
    if (!classroom) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Classroom not found' } })
      return
    }
    res.json({ data: classroom, error: null })
  } catch (err: unknown) {
    logger.error('student_classroom_detail_error', { studentId: req.userId, classroomId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch classroom' } })
  }
})

// ── GET /students/classrooms/:id/posts ──
router.get('/classrooms/:id/posts', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.id)
  if (isNaN(classroomId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroom id' } })
    return
  }
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  try {
    const membership = await prisma.classroomMembership.findUnique({
      where: { classroomId_studentId: { classroomId, studentId: req.userId } },
    })
    if (!membership) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You are not a member of this classroom' } })
      return
    }
    const page  = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = 20
    const posts = await prisma.classroomPost.findMany({
      where: { classroomId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            tag: true,
            tagColor: true,
            nameColor: true,
            avatarUrl: true,
          },
        },
      },
    })
    res.json({ data: posts, error: null })
  } catch (err: unknown) {
    logger.error('student_classroom_posts_list_error', { studentId: req.userId, classroomId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch posts' } })
  }
})

// ── POST /students/classrooms/:id/posts ──
const createClassroomPostSchema = z.object({
  body: z.string().min(1).max(500),
})

router.post('/classrooms/:id/posts', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const classroomId = parseInt(req.params.id)
  if (isNaN(classroomId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid classroom id' } })
    return
  }
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  const parse = createClassroomPostSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid body' } })
    return
  }
  try {
    const membership = await prisma.classroomMembership.findUnique({
      where: { classroomId_studentId: { classroomId, studentId: req.userId } },
    })
    if (!membership) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You are not a member of this classroom' } })
      return
    }
    const post = await prisma.classroomPost.create({
      data: { classroomId, authorId: req.userId, body: parse.data.body },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            tag: true,
            tagColor: true,
            nameColor: true,
            avatarUrl: true,
          },
        },
      },
    })
    sendToUser(req.userId, 'CLASSROOM_POST', { classroomId, post })
    logger.info('classroom_post_created', { authorId: req.userId, classroomId, postId: post.id })
    res.status(201).json({ data: post, error: null })
  } catch (err: unknown) {
    logger.error('student_classroom_post_create_error', { studentId: req.userId, classroomId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create post' } })
  }
})

// ── GET /students/action-items ──
router.get('/action-items', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  try {
    const items = await prisma.counselorActionItem.findMany({
      where: { studentId: req.userId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: items, error: null })
  } catch (err: unknown) {
    logger.error('student_action_items_error', { studentId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch action items' } })
  }
})

// ── POST /students/counselor-chat/:counselorId ──
const studentChatSchema = z.object({
  body: z.string().min(1).max(2000),
})

router.post('/counselor-chat/:counselorId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  const counselorId = parseInt(req.params.counselorId)
  if (isNaN(counselorId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid counselorId' } })
    return
  }
  const parse = studentChatSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  const studentId = req.userId
  try {
    const link = await prisma.counselorStudentLink.findUnique({
      where: { counselorId_studentId: { counselorId, studentId } },
    })
    if (!link || link.status !== 'ACTIVE') {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'No active counselor link found' } })
      return
    }
    const message = await prisma.counselorChatMessage.create({
      data: { counselorId, studentId, senderId: studentId, body: parse.data.body },
    })
    await writeAuditLog({
      userId: studentId,
      resourceType: 'COUNSELOR_CHAT',
      resourceId: counselorId.toString(),
      action: 'STUDENT_SENT_MESSAGE',
      ipAddress: req.ip ?? 'unknown',
    })
    if (supabaseAdmin) {
      await supabaseAdmin
        .channel(`counselor-chat:${counselorId}:${studentId}`)
        .send({ type: 'broadcast', event: 'message', payload: message })
        .catch((broadcastErr: unknown) => {
          logger.warn('student_chat_broadcast_failed', { counselorId, studentId, error: broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr) })
        })
    } else {
      logger.warn('supabase_admin_not_configured', { note: 'Chat broadcast skipped — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' })
    }
    res.status(201).json({ data: message, error: null })
  } catch (err: unknown) {
    logger.error('student_chat_send_error', { studentId, counselorId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to send message' } })
  }
})

// ── GET /students/counselor-chat/:counselorId ──
router.get('/counselor-chat/:counselorId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  const counselorId = parseInt(req.params.counselorId)
  if (isNaN(counselorId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid counselorId' } })
    return
  }
  const studentId = req.userId
  const cursorRaw = req.query.cursor !== undefined ? parseInt(req.query.cursor as string) : undefined
  const limitRaw = req.query.limit !== undefined ? parseInt(req.query.limit as string) : 50
  const limit = Math.min(isNaN(limitRaw) ? 50 : limitRaw, 100)
  const cursor = cursorRaw !== undefined && !isNaN(cursorRaw) ? cursorRaw : undefined

  try {
    const link = await prisma.counselorStudentLink.findUnique({
      where: { counselorId_studentId: { counselorId, studentId } },
    })
    if (!link || link.status !== 'ACTIVE') {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'No active counselor link found' } })
      return
    }
    const messages = await prisma.counselorChatMessage.findMany({
      where: {
        counselorId,
        studentId,
        ...(cursor !== undefined && { id: { lt: cursor } }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    await writeAuditLog({
      userId: studentId,
      resourceType: 'COUNSELOR_CHAT',
      resourceId: counselorId.toString(),
      action: 'STUDENT_READ_CHAT',
      ipAddress: req.ip ?? 'unknown',
    })
    const nextCursor = messages.length === limit ? messages[messages.length - 1]?.id : undefined
    res.json({ data: { messages, nextCursor: nextCursor ?? null }, error: null })
  } catch (err: unknown) {
    logger.error('student_chat_list_error', { studentId, counselorId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch messages' } })
  }
})

// ── POST /students/counselor-links/:counselorId/accept ── Student accepts a pending counselor link
router.post('/counselor-links/:counselorId/accept', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  const counselorId = parseInt(req.params.counselorId)
  if (isNaN(counselorId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid counselorId' } })
    return
  }
  const studentId = req.userId
  try {
    const link = await prisma.counselorStudentLink.findUnique({
      where: { counselorId_studentId: { counselorId, studentId } },
    })
    if (!link) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'No pending counselor link found' } })
      return
    }
    if (link.status === 'ACTIVE') {
      res.status(409).json({ data: null, error: { code: 'ALREADY_ACCEPTED', message: 'Counselor link already active' } })
      return
    }
    const updated = await prisma.counselorStudentLink.update({
      where: { counselorId_studentId: { counselorId, studentId } },
      data: { status: 'ACTIVE' },
    })
    await writeAuditLog({
      userId: studentId,
      resourceType: 'COUNSELOR_LINK',
      resourceId: counselorId.toString(),
      action: 'EDUCATOR_ACCESS_CONSENTED',
      ipAddress: req.ip ?? 'unknown',
    })
    logger.info('counselor_link_accepted', { studentId, counselorId })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('counselor_link_accept_error', { studentId, counselorId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to accept counselor link' } })
  }
})

// ── DELETE /students/counselor-links/:counselorId/decline ── Student declines a pending counselor link
router.delete('/counselor-links/:counselorId/decline', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  const counselorId = parseInt(req.params.counselorId)
  if (isNaN(counselorId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid counselorId' } })
    return
  }
  const studentId = req.userId
  try {
    const link = await prisma.counselorStudentLink.findUnique({
      where: { counselorId_studentId: { counselorId, studentId } },
    })
    if (!link) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'No counselor link found' } })
      return
    }
    await prisma.counselorStudentLink.delete({
      where: { counselorId_studentId: { counselorId, studentId } },
    })
    logger.info('counselor_link_declined', { studentId, counselorId })
    res.json({ data: { deleted: true }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_link_decline_error', { studentId, counselorId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to decline counselor link' } })
  }
})

// ── GET /students/counselor-links/active ── Student sees their active counselors
router.get('/counselor-links/active', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  try {
    const activeLinks = await prisma.counselorStudentLink.findMany({
      where: { studentId: req.userId, status: 'ACTIVE' },
      include: { counselor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ data: activeLinks, error: null })
  } catch (err: unknown) {
    logger.error('counselor_active_links_error', { studentId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch active counselor links' } })
  }
})

// ── GET /students/counselor-links/pending ── Student sees pending counselor link requests
router.get('/counselor-links/pending', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  try {
    const pendingLinks = await prisma.counselorStudentLink.findMany({
      where: { studentId: req.userId, status: 'PENDING' },
      include: { counselor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: pendingLinks, error: null })
  } catch (err: unknown) {
    logger.error('counselor_pending_links_error', { studentId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pending counselor links' } })
  }
})

// ── GET /students/counselor-portal/:counselorId ── Full portal data for a student's counselor
router.get('/counselor-portal/:counselorId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  const counselorId = parseInt(req.params.counselorId)
  if (isNaN(counselorId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid counselorId' } })
    return
  }
  const studentId = req.userId
  try {
    const link = await prisma.counselorStudentLink.findUnique({
      where: { counselorId_studentId: { counselorId, studentId } },
      include: { counselor: { select: { id: true, name: true, email: true } } },
    })
    if (!link || link.status !== 'ACTIVE') {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'No active counselor link found' } })
      return
    }
    const [notes, recommendations, actionItems] = await Promise.all([
      prisma.counselorNote.findMany({
        where: { counselorId, studentId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.counselorCourseRecommendation.findMany({
        where: { counselorId, studentId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.counselorActionItem.findMany({
        where: { counselorId, studentId },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    await writeAuditLog({
      userId: studentId,
      resourceType: 'COUNSELOR_PORTAL',
      resourceId: counselorId.toString(),
      action: 'STUDENT_VIEWED_COUNSELOR_PORTAL',
      ipAddress: req.ip ?? 'unknown',
    })
    res.json({
      data: { counselor: link.counselor, notes, recommendations, actionItems },
      error: null,
    })
  } catch (err: unknown) {
    logger.error('student_counselor_portal_error', { studentId, counselorId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch portal data' } })
  }
})

// ── PATCH /students/action-items/:id ── Toggle action item completion
router.patch('/action-items/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } })
    return
  }
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid action item id' } })
    return
  }
  try {
    const item = await prisma.counselorActionItem.findUnique({ where: { id } })
    if (!item || item.studentId !== req.userId) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Action item not found' } })
      return
    }
    const updated = await prisma.counselorActionItem.update({
      where: { id },
      data: { completed: !item.completed },
    })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('student_action_item_toggle_error', { studentId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update action item' } })
  }
})

export default router
