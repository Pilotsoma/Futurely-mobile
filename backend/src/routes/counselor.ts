import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../middleware/auth'
import { requireCounselor } from '../middleware/requireAdmin'
import { writeAuditLog } from '../lib/auditLog'
import { supabaseAdmin } from '../lib/supabaseAdmin'
import { logger } from '../common/logger'
import { calculateGpa } from '../lib/gpa'
import { sendToUser } from '../lib/websocket'

type HacGpa = { weighted: number; unweighted: number }

function extractHacGpa(hacDataCache: unknown): HacGpa | null {
  if (!hacDataCache || typeof hacDataCache !== 'object') return null
  const cache = hacDataCache as Record<string, { data?: unknown }>
  const entry = cache['transcript']
  if (!entry?.data) return null
  const t = entry.data as { weightedGPA?: string | null; unweightedGPA?: string | null }
  const w = parseFloat(t.weightedGPA ?? '')
  const u = parseFloat(t.unweightedGPA ?? '')
  if (isNaN(w) && isNaN(u)) return null
  return {
    weighted:   isNaN(w) ? 0 : Math.round(w * 1000) / 1000,
    unweighted: isNaN(u) ? 0 : Math.round(u * 1000) / 1000,
  }
}

function mergeGpa(
  profile: Record<string, unknown> | null,
  bestGpa: HacGpa | null,
  studentId: number
): Record<string, unknown> | null {
  if (profile) {
    return {
      ...profile,
      weightedGpa:   bestGpa?.weighted   ?? (typeof profile.weightedGpa   === 'number' && profile.weightedGpa   > 0 ? profile.weightedGpa   : null),
      unweightedGpa: bestGpa?.unweighted ?? (typeof profile.unweightedGpa === 'number' && profile.unweightedGpa > 0 ? profile.unweightedGpa : null),
    }
  }
  if (!bestGpa) return null
  return {
    userId: studentId, gradeLevel: null, graduationYear: null,
    satScore: null, actScore: null, counselorName: null, futureDecision: null,
    weightedGpa: bestGpa.weighted, unweightedGpa: bestGpa.unweighted,
  }
}

const router = Router()
router.use(requireCounselor)

// ── Helper: verify CounselorStudentLink (student must have accepted) ──
async function verifyLink(counselorId: number, studentId: number): Promise<boolean> {
  const link = await prisma.counselorStudentLink.findUnique({
    where: { counselorId_studentId: { counselorId, studentId } },
  })
  return link !== null && link.status === 'ACTIVE'
}

// ── GET /counselor/students/search?q=hacUsername ── Search students by HAC username
router.get('/students/search', async (req: AuthRequest, res: Response): Promise<void> => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 2) { res.json({ data: [], error: null }); return }
  try {
    const connections = await prisma.schoolConnection.findMany({
      where: {
        hacUsername: { contains: q, mode: 'insensitive' },
        user: { role: { notIn: ['TEACHER', 'COUNSELOR'] } },
      },
      select: {
        hacUsername: true,
        user: { select: { id: true, name: true, email: true } },
      },
      take: 10,
    })
    const results = connections.map(c => ({
      id: c.user.id,
      name: c.user.name,
      email: c.user.email,
      hacUsername: c.hacUsername,
    }))
    res.json({ data: results, error: null })
  } catch (err: unknown) {
    logger.error('counselor_search_students_error', { counselorId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Search failed' } })
  }
})

// ── POST /counselor/students ── Link a student
const linkStudentSchema = z.object({
  studentId: z.number().int(),
})

router.post('/students', async (req: AuthRequest, res: Response): Promise<void> => {
  const parse = linkStudentSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  const { studentId } = parse.data
  try {
    const student = await prisma.user.findUnique({ where: { id: studentId }, select: { role: true } })
    if (!student || ['TEACHER', 'COUNSELOR'].includes(student.role)) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }
    const link = await prisma.counselorStudentLink.create({
      data: { counselorId: req.userId!, studentId, status: 'ACTIVE' },
    })
    try {
      const notif = await prisma.notification.create({
        data: { userId: studentId, fromUserId: req.userId!, type: 'COUNSELOR_LINKED', preview: null },
        include: { sender: { select: { id: true, name: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } },
      })
      sendToUser(studentId, 'NOTIFICATION', notif)
    } catch { /* non-critical */ }
    logger.info('counselor_student_link_created', { counselorId: req.userId, studentId })
    res.status(201).json({ data: link, error: null })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      res.status(409).json({ data: null, error: { code: 'ALREADY_LINKED', message: 'Student is already linked to this counselor' } })
      return
    }
    logger.error('counselor_link_student_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to link student' } })
  }
})

// ── GET /counselor/students ── List all linked students
router.get('/students', async (req: AuthRequest, res: Response): Promise<void> => {
  const counselorId = req.userId!
  try {
    const links = await prisma.counselorStudentLink.findMany({
      where: { counselorId, status: 'ACTIVE' },
      include: {
        student: {
          select: {
            id: true, name: true, email: true, role: true, profile: true,
            courses: {
              include: { grades: { where: { gradingPeriod: 'CURRENT' }, take: 1 } },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    const unreadCounts = await Promise.all(
      links.map(async l => {
        const count = await prisma.counselorChatMessage.count({
          where: {
            counselorId,
            studentId: l.studentId,
            senderId: l.studentId,
            ...(l.counselorLastReadAt ? { createdAt: { gt: l.counselorLastReadAt } } : {}),
          },
        })
        return { studentId: l.studentId, count }
      })
    )
    const unreadMap = Object.fromEntries(unreadCounts.map(u => [u.studentId, u.count]))
    const data = links.map(l => {
      const { courses, ...studentWithoutCourses } = l.student
      const gradeInputs = courses.flatMap(c =>
        c.grades.map(g => ({ letterGrade: g.letterGrade, creditHours: c.creditHours, courseType: c.courseType }))
      )
      const computed = calculateGpa(gradeInputs)
      const profile = studentWithoutCourses.profile
        ? {
            ...studentWithoutCourses.profile,
            weightedGpa:   computed?.weighted   ?? studentWithoutCourses.profile.weightedGpa,
            unweightedGpa: computed?.unweighted ?? studentWithoutCourses.profile.unweightedGpa,
          }
        : null
      return { ...studentWithoutCourses, profile, unreadCount: unreadMap[l.studentId] ?? 0 }
    })
    res.json({ data, error: null })
  } catch (err: unknown) {
    logger.error('counselor_list_students_error', { counselorId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch students' } })
  }
})

// ── PUT /counselor/students/:studentId/chat/read ── Mark chat as read
router.put('/students/:studentId/chat/read', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  const counselorId = req.userId!
  try {
    await prisma.counselorStudentLink.update({
      where: { counselorId_studentId: { counselorId, studentId } },
      data: { counselorLastReadAt: new Date() },
    })
    res.json({ data: { ok: true }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_mark_read_error', { counselorId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to mark chat as read' } })
  }
})

// ── GET /counselor/unread-total ── Total unread count across all students
router.get('/unread-total', async (req: AuthRequest, res: Response): Promise<void> => {
  const counselorId = req.userId!
  try {
    const links = await prisma.counselorStudentLink.findMany({
      where: { counselorId, status: 'ACTIVE' },
      select: { studentId: true, counselorLastReadAt: true },
    })
    const counts = await Promise.all(
      links.map(l =>
        prisma.counselorChatMessage.count({
          where: {
            counselorId,
            studentId: l.studentId,
            senderId: l.studentId,
            ...(l.counselorLastReadAt ? { createdAt: { gt: l.counselorLastReadAt } } : {}),
          },
        })
      )
    )
    const studentsWithUnread = counts.filter(c => c > 0).length
    res.json({ data: { total: studentsWithUnread }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_unread_total_error', { counselorId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch unread count' } })
  }
})

// ── DELETE /counselor/students/:studentId ── Remove link
router.delete('/students/:studentId', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  try {
    const link = await prisma.counselorStudentLink.findUnique({
      where: { counselorId_studentId: { counselorId: req.userId!, studentId } },
    })
    if (!link) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Link not found' } })
      return
    }
    await prisma.counselorStudentLink.delete({
      where: { counselorId_studentId: { counselorId: req.userId!, studentId } },
    })
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'COUNSELOR_LINK',
      resourceId: studentId.toString(),
      action: 'COUNSELOR_LINK_REMOVED',
      ipAddress: req.ip ?? 'unknown',
    })
    logger.info('counselor_student_unlinked', { counselorId: req.userId, studentId })
    res.json({ data: { unlinked: true }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_unlink_student_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to unlink student' } })
  }
})

// ── GET /counselor/students/:studentId ── Full student profile
router.get('/students/:studentId', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
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

    // GPA priority: HAC transcript cache > computed from courses > stored profile value
    const schoolConn = await prisma.schoolConnection.findUnique({
      where: { userId: studentId },
      select: { hacDataCache: true },
    })
    const hacGpa = extractHacGpa(schoolConn?.hacDataCache)

    const gradeInputs = student.courses.flatMap(c =>
      c.grades.map(g => ({ letterGrade: g.letterGrade, creditHours: c.creditHours, courseType: c.courseType }))
    )
    const computedGpa = calculateGpa(gradeInputs)
    const bestGpa: HacGpa | null = hacGpa
      ?? (computedGpa ? { weighted: computedGpa.weighted, unweighted: computedGpa.unweighted } : null)

    const profile = mergeGpa(student.profile as Record<string, unknown> | null, bestGpa, studentId)

    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'STUDENT_PROFILE',
      resourceId: studentId.toString(),
      action: 'COUNSELOR_VIEWED_STUDENT',
      ipAddress: req.ip ?? 'unknown',
    })
    res.json({ data: { ...student, profile }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_student_view_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch student data' } })
  }
})

// ── GET /counselor/students/:studentId/courses ──
router.get('/students/:studentId/courses', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const courses = await prisma.course.findMany({
      where: { userId: studentId },
      include: { grades: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { period: 'asc' },
    })
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'STUDENT_COURSES',
      resourceId: studentId.toString(),
      action: 'COUNSELOR_VIEWED_COURSES',
      ipAddress: req.ip ?? 'unknown',
    })
    res.json({ data: courses, error: null })
  } catch (err: unknown) {
    logger.error('counselor_courses_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch courses' } })
  }
})

// ── POST /counselor/students/:studentId/courses/:courseId/comments ──
const courseCommentSchema = z.object({
  body: z.string().min(1).max(2000),
})

router.post('/students/:studentId/courses/:courseId/comments', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  const courseId = parseInt(req.params.courseId)
  if (isNaN(studentId) || isNaN(courseId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId or courseId' } })
    return
  }
  const parse = courseCommentSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const course = await prisma.course.findFirst({ where: { id: courseId, userId: studentId } })
    if (!course) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Course not found for this student' } })
      return
    }
    const comment = await prisma.counselorCourseComment.create({
      data: { counselorId: req.userId!, studentId, courseId, body: parse.data.body },
    })
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'COURSE_COMMENT',
      resourceId: courseId.toString(),
      action: 'COUNSELOR_COMMENTED_COURSE',
      ipAddress: req.ip ?? 'unknown',
    })
    res.status(201).json({ data: comment, error: null })
  } catch (err: unknown) {
    logger.error('counselor_course_comment_error', { counselorId: req.userId, studentId, courseId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create comment' } })
  }
})

// ── GET /counselor/students/:studentId/courses/:courseId/comments ──
router.get('/students/:studentId/courses/:courseId/comments', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  const courseId = parseInt(req.params.courseId)
  if (isNaN(studentId) || isNaN(courseId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId or courseId' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const comments = await prisma.counselorCourseComment.findMany({
      where: { counselorId: req.userId!, studentId, courseId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: comments, error: null })
  } catch (err: unknown) {
    logger.error('counselor_course_comments_list_error', { counselorId: req.userId, studentId, courseId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch comments' } })
  }
})

// ── POST /counselor/students/:studentId/recommendations ──
const createRecommendationSchema = z.object({
  courseName: z.string().min(1).max(200),
  courseCode: z.string().max(50).optional(),
  rationale: z.string().max(2000).optional(),
  semester: z.string().min(1).max(50),
})

router.post('/students/:studentId/recommendations', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  const parse = createRecommendationSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const rec = await prisma.counselorCourseRecommendation.create({
      data: {
        counselorId: req.userId!,
        studentId,
        courseName: parse.data.courseName,
        courseCode: parse.data.courseCode,
        rationale: parse.data.rationale,
        semester: parse.data.semester,
      },
    })
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'COURSE_RECOMMENDATION',
      resourceId: studentId.toString(),
      action: 'COUNSELOR_CREATED_RECOMMENDATION',
      ipAddress: req.ip ?? 'unknown',
    })
    try {
      const notif = await prisma.notification.create({
        data: { userId: studentId, fromUserId: req.userId!, type: 'COUNSELOR_RECOMMENDATION_ADDED', preview: parse.data.courseName },
        include: { sender: { select: { id: true, name: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } },
      })
      sendToUser(studentId, 'NOTIFICATION', notif)
    } catch { /* non-critical */ }
    res.status(201).json({ data: rec, error: null })
  } catch (err: unknown) {
    logger.error('counselor_recommendation_create_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create recommendation' } })
  }
})

// ── GET /counselor/students/:studentId/recommendations ──
router.get('/students/:studentId/recommendations', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const recs = await prisma.counselorCourseRecommendation.findMany({
      where: { counselorId: req.userId!, studentId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: recs, error: null })
  } catch (err: unknown) {
    logger.error('counselor_recommendations_list_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch recommendations' } })
  }
})

// ── DELETE /counselor/recommendations/:id ──
router.delete('/recommendations/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  try {
    const rec = await prisma.counselorCourseRecommendation.findUnique({ where: { id } })
    if (!rec) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Recommendation not found' } })
      return
    }
    if (rec.counselorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this recommendation' } })
      return
    }
    await prisma.counselorCourseRecommendation.delete({ where: { id } })
    res.json({ data: { deleted: true }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_recommendation_delete_error', { counselorId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete recommendation' } })
  }
})

// ── POST /counselor/students/:studentId/notes ──
const noteBodySchema = z.object({
  body: z.string().min(1).max(5000),
})

router.post('/students/:studentId/notes', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  const parse = noteBodySchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const note = await prisma.counselorNote.create({
      data: { counselorId: req.userId!, studentId, body: parse.data.body },
    })
    await writeAuditLog({
      userId: req.userId!,
      resourceType: 'COUNSELOR_NOTE',
      resourceId: studentId.toString(),
      action: 'COUNSELOR_CREATED_NOTE',
      ipAddress: req.ip ?? 'unknown',
    })
    try {
      const notif = await prisma.notification.create({
        data: { userId: studentId, fromUserId: req.userId!, type: 'COUNSELOR_NOTE_ADDED', preview: parse.data.body.slice(0, 120) },
        include: { sender: { select: { id: true, name: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } },
      })
      sendToUser(studentId, 'NOTIFICATION', notif)
    } catch { /* non-critical */ }
    res.status(201).json({ data: note, error: null })
  } catch (err: unknown) {
    logger.error('counselor_note_create_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create note' } })
  }
})

// ── GET /counselor/students/:studentId/notes ──
router.get('/students/:studentId/notes', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const notes = await prisma.counselorNote.findMany({
      where: { counselorId: req.userId!, studentId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: notes, error: null })
  } catch (err: unknown) {
    logger.error('counselor_notes_list_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch notes' } })
  }
})

// ── PATCH /counselor/notes/:id ──
router.patch('/notes/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  const parse = noteBodySchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const note = await prisma.counselorNote.findUnique({ where: { id } })
    if (!note) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Note not found' } })
      return
    }
    if (note.counselorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this note' } })
      return
    }
    const updated = await prisma.counselorNote.update({ where: { id }, data: { body: parse.data.body } })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('counselor_note_update_error', { counselorId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update note' } })
  }
})

// ── DELETE /counselor/notes/:id ──
router.delete('/notes/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  try {
    const note = await prisma.counselorNote.findUnique({ where: { id } })
    if (!note) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Note not found' } })
      return
    }
    if (note.counselorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this note' } })
      return
    }
    await prisma.counselorNote.delete({ where: { id } })
    res.json({ data: { deleted: true }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_note_delete_error', { counselorId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete note' } })
  }
})

// ── POST /counselor/students/:studentId/action-items ──
const createActionItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  dueDate: z.string().datetime().optional(),
})

router.post('/students/:studentId/action-items', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  const parse = createActionItemSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const item = await prisma.counselorActionItem.create({
      data: {
        counselorId: req.userId!,
        studentId,
        title: parse.data.title,
        description: parse.data.description,
        dueDate: parse.data.dueDate ? new Date(parse.data.dueDate) : undefined,
      },
    })
    try {
      const notif = await prisma.notification.create({
        data: { userId: studentId, fromUserId: req.userId!, type: 'ACTION_ITEM_CREATED', preview: parse.data.title },
        include: { sender: { select: { id: true, name: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } },
      })
      sendToUser(studentId, 'NOTIFICATION', notif)
    } catch { /* non-critical */ }
    res.status(201).json({ data: item, error: null })
  } catch (err: unknown) {
    logger.error('counselor_action_item_create_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create action item' } })
  }
})

// ── GET /counselor/students/:studentId/action-items ──
router.get('/students/:studentId/action-items', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  try {
    const linked = await verifyLink(req.userId!, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const items = await prisma.counselorActionItem.findMany({
      where: { counselorId: req.userId!, studentId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: items, error: null })
  } catch (err: unknown) {
    logger.error('counselor_action_items_list_error', { counselorId: req.userId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch action items' } })
  }
})

// ── PATCH /counselor/action-items/:id ──
const updateActionItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  completed: z.boolean().optional(),
})

router.patch('/action-items/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  const parse = updateActionItemSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const item = await prisma.counselorActionItem.findUnique({ where: { id } })
    if (!item) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Action item not found' } })
      return
    }
    if (item.counselorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this action item' } })
      return
    }
    const { title, description, dueDate, completed } = parse.data
    const updated = await prisma.counselorActionItem.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(completed !== undefined && { completed }),
        ...(completed === true && { completedAt: new Date() }),
        ...(completed === false && { completedAt: null }),
      },
    })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('counselor_action_item_update_error', { counselorId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update action item' } })
  }
})

// ── DELETE /counselor/action-items/:id ──
router.delete('/action-items/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } })
    return
  }
  try {
    const item = await prisma.counselorActionItem.findUnique({ where: { id } })
    if (!item) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Action item not found' } })
      return
    }
    if (item.counselorId !== req.userId!) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not own this action item' } })
      return
    }
    await prisma.counselorActionItem.delete({ where: { id } })
    res.json({ data: { deleted: true }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_action_item_delete_error', { counselorId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete action item' } })
  }
})

// ── POST /counselor/students/:studentId/chat ──
const chatMessageSchema = z.object({
  body: z.string().min(1).max(2000),
})

router.post('/students/:studentId/chat', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  const parse = chatMessageSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  const counselorId = req.userId!
  try {
    const linked = await verifyLink(counselorId, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
      return
    }
    const message = await prisma.counselorChatMessage.create({
      data: { counselorId, studentId, senderId: counselorId, body: parse.data.body },
    })
    if (supabaseAdmin) {
      await supabaseAdmin
        .channel(`counselor-chat:${counselorId}:${studentId}`)
        .send({ type: 'broadcast', event: 'message', payload: message })
        .catch((broadcastErr: unknown) => {
          logger.warn('counselor_chat_broadcast_failed', { counselorId, studentId, error: broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr) })
        })
    } else {
      logger.warn('supabase_admin_not_configured', { note: 'Chat broadcast skipped — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' })
    }
    await writeAuditLog({
      userId: counselorId,
      resourceType: 'COUNSELOR_CHAT',
      resourceId: studentId.toString(),
      action: 'COUNSELOR_SENT_MESSAGE',
      ipAddress: req.ip ?? 'unknown',
    })
    res.status(201).json({ data: message, error: null })
  } catch (err: unknown) {
    logger.error('counselor_chat_send_error', { counselorId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to send message' } })
  }
})

// ── GET /counselor/students/:studentId/chat ──
router.get('/students/:studentId/chat', async (req: AuthRequest, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.studentId)
  if (isNaN(studentId)) {
    res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid studentId' } })
    return
  }
  const counselorId = req.userId!
  const cursorRaw = req.query.cursor !== undefined ? parseInt(req.query.cursor as string) : undefined
  const limitRaw = req.query.limit !== undefined ? parseInt(req.query.limit as string) : 50
  const limit = Math.min(isNaN(limitRaw) ? 50 : limitRaw, 100)
  const cursor = cursorRaw !== undefined && !isNaN(cursorRaw) ? cursorRaw : undefined

  try {
    const linked = await verifyLink(counselorId, studentId)
    if (!linked) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Student is not linked to this counselor' } })
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
      userId: counselorId,
      resourceType: 'COUNSELOR_CHAT',
      resourceId: studentId.toString(),
      action: 'COUNSELOR_READ_CHAT',
      ipAddress: req.ip ?? 'unknown',
    })
    const nextCursor = messages.length === limit ? messages[messages.length - 1]?.id : undefined
    res.json({ data: { messages, nextCursor: nextCursor ?? null }, error: null })
  } catch (err: unknown) {
    logger.error('counselor_chat_list_error', { counselorId, studentId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch messages' } })
  }
})

export default router
