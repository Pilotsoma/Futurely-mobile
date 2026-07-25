import { Router, Response, Request, NextFunction } from 'express'
import { z } from 'zod'
import { AuthRequest } from '../../middleware/auth'
import { prisma } from '../../lib/prisma'
import { logger } from '../../common/logger'
import { encryptPassword, decryptPassword } from '../grades/credentialCrypto'
import { ASSIGNMENT_SOURCE } from '../../constants/assignmentSource'
import {
  verifyCanvasToken,
  fetchCanvasCourses,
  fetchCanvasUpcomingAssignments,
  fetchCanvasOverdueAssignments,
  fetchCanvasCoursesWithGrades,
  fetchCanvasAssignmentsWithSubmissions,
  fetchCanvasTodo,
  fetchCanvasModules,
  fetchCanvasAnnouncements,
  fetchCanvasAssignmentDetail,
  fetchCanvasCourseFiles,
  fetchCanvasPage,
  fetchCanvasDiscussionTopic,
  fetchCanvasDiscussionView,
  postCanvasDiscussionEntry,
  fetchCanvasQuizDetail,
  fetchCanvasQuizQuestions,
  fetchCanvasQuizSubmissions,
  submitCanvasAssignment,
  startCanvasQuizSubmission,
  fetchCanvasSubmissionQuestions,
  saveCanvasQuizAnswers,
  completeCanvasQuizSubmission,
  CanvasTokenError,
  CanvasNetworkError,
} from './canvasClient'
import { sendToUser } from '../../lib/websocket'

const router = Router()

// ── Known college Canvas instance URLs ──────────────────────────────────────
// Colleges in the ISD list have canvasUrl but NO hacUrl.
// Keep this in sync with lib/isds.ts on the frontend.
const COLLEGE_CANVAS_HOSTS = new Set([
  'hccs.instructure.com',            // Houston Community College
  'sanjacinto.instructure.com',      // San Jacinto College
  'lonestar.instructure.com',        // Lone Star College
  'austincc.instructure.com',        // Austin Community College
  'collin.instructure.com',          // Collin College
  'dcccd.instructure.com',           // Dallas College
  'tarrantcounty.instructure.com',  // Tarrant County College
])

/** Returns true when the Canvas host belongs to a known college / university. */
function isCollegeInstance(canvasHost: string): boolean {
  const normalised = canvasHost.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  return COLLEGE_CANVAS_HOSTS.has(normalised)
}

// ── Input schemas ────────────────────────────────────────────────────────────

const connectSchema = z.object({
  canvasInstanceUrl: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Must be a hostname, not a full URL')
    .transform(url => url.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')),
  accessToken: z.string().min(10).max(2048),
})

const disconnectSchema = z.object({
  canvasInstanceUrl: z.string().min(3).max(253),
})

// ── Async route wrapper ──────────────────────────────────────────────────────

function asyncHandler(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req as AuthRequest, res, next)).catch(async err => {
      if (err instanceof CanvasTokenError) {
        const userId = (req as AuthRequest).userId
        const instanceUrl =
          (req.query.canvasInstanceUrl as string | undefined) ||
          (req.body as { canvasInstanceUrl?: string } | undefined)?.canvasInstanceUrl
        if (userId) {
          try {
            await prisma.canvasConnection.updateMany({
              where: { userId, ...(instanceUrl ? { canvasInstanceUrl: instanceUrl } : {}) },
              data: { tokenInvalid: true },
            })
          } catch { /* best effort */ }
        }
        if (!res.headersSent) {
          res.status(401).json({
            data: null,
            error: { code: 'CANVAS_TOKEN_EXPIRED', message: 'Canvas access token is invalid or expired.' },
          })
        }
        return
      }
      if (!res.headersSent) {
        logger.error('Unhandled Canvas route error', {
          message: err instanceof Error ? err.message : String(err),
        })
        res.status(500).json({
          data: null,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        })
      }
    })
  }
}

// ── POST /connect ────────────────────────────────────────────────────────────

router.post(
  '/connect',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!

    const parse = connectSchema.safeParse(req.body)
    if (!parse.success) {
      res.status(400).json({
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parse.error.errors[0]?.message ?? 'Invalid request',
        },
      })
      return
    }

    const { canvasInstanceUrl, accessToken } = parse.data

    logger.info('Canvas connect attempt', { userId, canvasInstanceUrl })

    // ── Multi-connection validation ─────────────────────────────────────────
    const existingConnections = await prisma.canvasConnection.findMany({
      where: { userId },
    })

    // Check if this exact instance is already connected
    const alreadyConnected = existingConnections.find(
      c => c.canvasInstanceUrl === canvasInstanceUrl,
    )
    if (alreadyConnected) {
      res.status(409).json({
        data: null,
        error: {
          code: 'ALREADY_CONNECTED',
          message: 'This Canvas instance is already connected.',
        },
      })
      return
    }

    const targetIsCollege = isCollegeInstance(canvasInstanceUrl)
    const hasHighSchoolConnection = existingConnections.some(
      c => !isCollegeInstance(c.canvasInstanceUrl),
    )

    // Block a second high-school connection
    if (!targetIsCollege && hasHighSchoolConnection) {
      res.status(422).json({
        data: null,
        error: {
          code: 'HIGH_SCHOOL_EXISTS',
          message:
            'You already have a high school Canvas connected. Disconnect it first to link a different one, or connect a college Canvas for dual credit.',
        },
      })
      return
    }

    // Limit: at most 1 high-school + 1 college (2 total)
    if (existingConnections.length >= 2) {
      res.status(422).json({
        data: null,
        error: {
          code: 'MAX_CONNECTIONS',
          message:
            'You can connect at most one high school and one college Canvas. Disconnect an existing one first.',
        },
      })
      return
    }

    // ── Verify token against Canvas ─────────────────────────────────────────
    let self: Awaited<ReturnType<typeof verifyCanvasToken>>
    try {
      self = await verifyCanvasToken(canvasInstanceUrl, accessToken)
    } catch (err) {
      if (err instanceof CanvasTokenError) {
        res.status(422).json({
          data: null,
          error: {
            code: 'CANVAS_TOKEN_INVALID',
            message: 'The Canvas access token is invalid or has been revoked.',
          },
        })
        return
      }
      if (err instanceof CanvasNetworkError) {
        res.status(502).json({
          data: null,
          error: {
            code: 'CANVAS_UNREACHABLE',
            message: 'Cannot reach the Canvas instance. Check the hostname and try again.',
          },
        })
        return
      }
      throw err
    }

    const encryptedToken = encryptPassword(accessToken)

    const existingCanvas = await prisma.canvasConnection.findFirst({ where: { userId, canvasInstanceUrl }, select: { id: true } })
    if (existingCanvas) {
      await prisma.canvasConnection.update({
        where: { id: existingCanvas.id },
        data: { encryptedToken, canvasUserId: String(self.id), canvasUserName: self.name, syncStatus: null, syncError: null, lastSynced: null },
      })
    } else {
      await prisma.canvasConnection.create({
        data: { userId, canvasInstanceUrl, encryptedToken, canvasUserId: String(self.id), canvasUserName: self.name },
      })
    }

    await prisma.complianceAuditLog.create({
      data: {
        userId,
        resourceType: 'CANVAS_CONNECTION',
        action: 'CANVAS_CONNECT',
        ipAddress: req.ip ?? 'unknown',
        timestamp: new Date(),
      },
    })

    logger.info('Canvas connection established', { userId, canvasUserId: String(self.id) })

    res.status(201).json({
      data: {
        connected: true,
        canvasUserName: self.name,
        canvasInstanceUrl,
      },
    })
  })
)

// ── POST /sync ───────────────────────────────────────────────────────────────
// Syncs ALL connected Canvas instances for the user.

router.post(
  '/sync',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!

    const connections = await prisma.canvasConnection.findMany({
      where: { userId },
    })

    if (connections.length === 0) {
      res.status(404).json({
        data: null,
        error: {
          code: 'NOT_CONNECTED',
          message: 'No Canvas account connected. Connect your Canvas account first.',
        },
      })
      return
    }

    let totalSynced = 0
    let lastError: string | null = null

    for (const connection of connections) {
      const token = decryptPassword(connection.encryptedToken)
      const { canvasInstanceUrl } = connection

      await prisma.canvasConnection.update({
        where: { userId_canvasInstanceUrl: { userId, canvasInstanceUrl } },
        data: { syncStatus: 'syncing' },
      })

      logger.info('Canvas sync starting', { userId, canvasInstanceUrl })

      let courses: Awaited<ReturnType<typeof fetchCanvasCourses>>
      let upcomingAssignments: Awaited<ReturnType<typeof fetchCanvasUpcomingAssignments>>
      let overdueAssignments: Awaited<ReturnType<typeof fetchCanvasOverdueAssignments>>

      try {
        courses = await fetchCanvasCourses(canvasInstanceUrl, token)
        const courseIds = courses.map(c => c.id)
        ;[upcomingAssignments, overdueAssignments] = await Promise.all([
          fetchCanvasUpcomingAssignments(canvasInstanceUrl, token, courseIds),
          fetchCanvasOverdueAssignments(canvasInstanceUrl, token, courseIds),
        ])
      } catch (err) {
        if (err instanceof CanvasTokenError) {
          await prisma.canvasConnection.update({
            where: { userId_canvasInstanceUrl: { userId, canvasInstanceUrl } },
            data: { syncStatus: 'error', syncError: 'TOKEN_REVOKED', consecutiveSyncFailures: { increment: 1 } },
          })
          lastError = 'CANVAS_TOKEN_EXPIRED'
          continue
        }
        if (err instanceof CanvasNetworkError) {
          // Store a safe code — err.message is returned to the client via GET /status.
          // Increment consecutiveSyncFailures so the frontend can derive portalDown
          // (syncError === 'NETWORK_ERROR' && consecutiveSyncFailures >= 2).
          await prisma.canvasConnection.update({
            where: { userId_canvasInstanceUrl: { userId, canvasInstanceUrl } },
            data: { syncStatus: 'error', syncError: 'NETWORK_ERROR', consecutiveSyncFailures: { increment: 1 } },
          })
          lastError = 'CANVAS_UNREACHABLE'
          continue
        }
        throw err
      }

      const courseMap = new Map<number, string>()
      for (const course of courses) {
        courseMap.set(course.id, course.name)
      }

      // Merge upcoming + overdue, dedup by name+course
      const seen = new Set<string>()
      const allAssignments = [...upcomingAssignments, ...overdueAssignments].filter(a => {
        const key = `${a.course_id}:${a.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const SEVEN_DAYS_MS = 7 * 86400000

      const isSubmitted = (submission?: typeof allAssignments[number]['submission']): boolean => {
        if (!submission) return false
        return submission.submitted_at !== null
          || submission.workflow_state === 'submitted'
          || submission.workflow_state === 'graded'
      }

      const upsertPayloads = allAssignments.map(assignment => {
        const dueDate = assignment.due_at
          ? new Date(assignment.due_at)
          : new Date(Date.now() + SEVEN_DAYS_MS)
        // Only treat unlock_at as a span start when it's a distinct earlier day —
        // most Canvas assignments unlock the moment they're due, which isn't a span.
        const unlockDate = assignment.unlock_at ? new Date(assignment.unlock_at) : null
        const startDate = unlockDate && unlockDate.getTime() < dueDate.getTime() - 86400000 ? unlockDate : null

        return {
          userId,
          title: assignment.name.slice(0, 500),
          subject: courseMap.get(assignment.course_id) ?? `Canvas Course ${assignment.course_id}`,
          startDate,
          dueDate,
          source: ASSIGNMENT_SOURCE.CANVAS,
          completed: isSubmitted(assignment.submission),
          completedAt: assignment.submission?.submitted_at ? new Date(assignment.submission.submitted_at) : null,
        }
      })

      // Track which assignments are genuinely new (not just updates)
      const existingKeys = new Set(
        (await prisma.assignment.findMany({
          where: { userId, source: ASSIGNMENT_SOURCE.CANVAS },
          select: { title: true, subject: true },
        })).map(a => `${a.title}::${a.subject}`)
      )

      for (const payload of upsertPayloads) {
        const existing = await prisma.assignment.findFirst({
          where: { userId: payload.userId, title: payload.title, subject: payload.subject },
          select: { id: true },
        })
        if (existing) {
          // Canvas can confirm an assignment is done (submitted), but its absence
          // of submission data should never override a user's manual completion.
          await prisma.assignment.update({
            where: { id: existing.id },
            data: {
              startDate: payload.startDate,
              dueDate: payload.dueDate,
              ...(payload.completed && { completed: true, completedAt: payload.completedAt ?? new Date() }),
            },
          })
        } else {
          await prisma.assignment.create({ data: payload })
        }
      }

      // Send one summary notification for newly added Canvas assignments
      const newPayloads = upsertPayloads.filter(p => !existingKeys.has(`${p.title}::${p.subject}`))
      if (newPayloads.length > 0) {
        try {
          const preview = newPayloads.length === 1
            ? `New Canvas assignment: ${newPayloads[0].title}`
            : `${newPayloads.length} new Canvas assignments added`
          const notif = await prisma.notification.create({
            data: { userId, fromUserId: userId, type: 'ASSIGNMENT_CREATED', preview },
            include: { sender: { select: { id: true, name: true, email: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } },
          })
          sendToUser(userId, 'NOTIFICATION', notif)
        } catch { /* non-critical */ }
      }

      await prisma.canvasConnection.update({
        where: { userId_canvasInstanceUrl: { userId, canvasInstanceUrl } },
        data: {
          lastSynced: new Date(),
          syncStatus: 'complete',
          syncError: null,
          consecutiveSyncFailures: 0,
        },
      })

      await prisma.complianceAuditLog.create({
        data: {
          userId,
          resourceType: 'CANVAS_ASSIGNMENTS',
          resourceId: String(userId),
          action: 'CANVAS_SYNC',
          ipAddress: req.ip ?? 'unknown',
          timestamp: new Date(),
        },
      })

      logger.info('Canvas sync complete', { userId, canvasInstanceUrl, syncedCount: upsertPayloads.length })
      totalSynced += upsertPayloads.length
    }

    if (lastError && totalSynced === 0) {
      const status = lastError === 'CANVAS_TOKEN_EXPIRED' ? 401 : 502
      res.status(status).json({
        data: null,
        error: {
          code: lastError,
          message:
            lastError === 'CANVAS_TOKEN_EXPIRED'
              ? 'Canvas access token has been revoked. Please reconnect your Canvas account.'
              : 'Cannot reach Canvas. Check your connection and try again.',
        },
      })
      return
    }

    res.status(200).json({
      data: {
        syncedCount: totalSynced,
        assignments: [],
      },
    })
  })
)

// ── GET /grades ──────────────────────────────────────────────────────────────
// Returns courses + assignments with submission/score data for all connections.

router.get(
  '/grades',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!

    const connections = await prisma.canvasConnection.findMany({ where: { userId } })

    if (connections.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' },
      })
      return
    }

    const result = await Promise.all(connections.map(async connection => {
      const token = decryptPassword(connection.encryptedToken)
      const { canvasInstanceUrl, canvasUserName } = connection

      try {
        const courses = await fetchCanvasCoursesWithGrades(canvasInstanceUrl, token)
        const coursesWithAssignments = await Promise.all(
          courses.map(async course => ({
            ...course,
            assignments: await fetchCanvasAssignmentsWithSubmissions(canvasInstanceUrl, token, course.id),
          }))
        )
        return { canvasInstanceUrl, canvasUserName, courses: coursesWithAssignments }
      } catch (err) {
        const code = err instanceof CanvasTokenError ? 'TOKEN_EXPIRED' : 'FETCH_FAILED'
        return { canvasInstanceUrl, canvasUserName, error: code, courses: [] }
      }
    }))

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_GRADES', action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.status(200).json({ data: result })
  })
)

// ── GET /status ──────────────────────────────────────────────────────────────
// Returns all Canvas connections for the user.

router.get(
  '/status',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!

    const connections = await prisma.canvasConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })

    if (connections.length === 0) {
      res.status(200).json({
        data: {
          connected: false,
          connections: [],
          // Keep backwards-compat fields (null)
          canvasInstanceUrl: null,
          canvasUserName: null,
          lastSynced: null,
          syncStatus: null,
          syncError: null,
          consecutiveSyncFailures: 0,
          portalDown: false,
        },
      })
      return
    }

    // A Canvas portal is considered "down" when the last error is NETWORK_ERROR
    // (the Canvas instance was genuinely unreachable, not a token issue) AND we
    // have seen at least 2 consecutive failures. Threshold of 2 avoids false-positive
    // alerts from a single transient network blip — two consecutive NETWORK_ERROR
    // cycles is a strong signal the Canvas instance itself is the problem.
    const first = connections[0]
    const firstPortalDown =
      first.syncError === 'NETWORK_ERROR' && first.consecutiveSyncFailures >= 2

    res.status(200).json({
      data: {
        connected: true,
        connections: connections.map(c => ({
          canvasInstanceUrl: c.canvasInstanceUrl,
          canvasUserName: c.canvasUserName,
          lastSynced: c.lastSynced,
          syncStatus: c.syncStatus,
          syncError: c.syncError,
          tokenInvalid: c.tokenInvalid,
          consecutiveSyncFailures: c.consecutiveSyncFailures,
          portalDown: c.syncError === 'NETWORK_ERROR' && c.consecutiveSyncFailures >= 2,
        })),
        // Backwards-compat: first connection
        canvasInstanceUrl: first.canvasInstanceUrl,
        canvasUserName: first.canvasUserName,
        lastSynced: first.lastSynced,
        syncStatus: first.syncStatus,
        syncError: first.syncError,
        tokenInvalid: first.tokenInvalid,
        consecutiveSyncFailures: first.consecutiveSyncFailures,
        portalDown: firstPortalDown,
      },
    })
  })
)

// ── DELETE /disconnect ───────────────────────────────────────────────────────
// Disconnects a specific Canvas instance, or all if no URL provided.

router.delete(
  '/disconnect',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!

    // Accept body or query param for the instance URL
    const bodyParse = disconnectSchema.safeParse(req.body ?? {})
    const canvasInstanceUrl: string | undefined =
      bodyParse.data?.canvasInstanceUrl ?? (req.query.canvasInstanceUrl as string | undefined)

    logger.info('Canvas disconnect requested', { userId, canvasInstanceUrl })

    if (canvasInstanceUrl) {
      // Disconnect specific instance
      const deleteResult = await prisma.assignment.deleteMany({
        where: { userId, source: ASSIGNMENT_SOURCE.CANVAS, subject: { contains: '' } },
      })

      // Delete assignments that came from this Canvas instance
      // We identify them by looking up courses synced from this instance
      await prisma.canvasConnection.delete({
        where: { userId_canvasInstanceUrl: { userId, canvasInstanceUrl } },
      })

      await prisma.complianceAuditLog.create({
        data: {
          userId,
          resourceType: 'CANVAS_CONNECTION',
          action: 'CANVAS_DISCONNECT',
          ipAddress: req.ip ?? 'unknown',
          timestamp: new Date(),
        },
      })

      logger.info('Canvas disconnected', { userId, canvasInstanceUrl })

      res.status(200).json({
        data: {
          disconnected: true,
          canvasInstanceUrl,
          deletedAssignmentsCount: deleteResult.count,
        },
      })
    } else {
      // Disconnect ALL
      const deleteResult = await prisma.assignment.deleteMany({
        where: { userId, source: ASSIGNMENT_SOURCE.CANVAS },
      })

      await prisma.canvasConnection.deleteMany({ where: { userId } })

      await prisma.complianceAuditLog.create({
        data: {
          userId,
          resourceType: 'CANVAS_CONNECTION',
          action: 'CANVAS_DISCONNECT',
          ipAddress: req.ip ?? 'unknown',
          timestamp: new Date(),
        },
      })

      logger.info('Canvas disconnected (all)', { userId, deletedAssignmentsCount: deleteResult.count })

      res.status(200).json({
        data: {
          disconnected: true,
          deletedAssignmentsCount: deleteResult.count,
        },
      })
    }
  })
)

// ── Shared helper: resolve a connection by optional instance URL ─────────────

async function resolveConnection(
  userId: number,
  instanceUrl?: string,
): Promise<{ canvasInstanceUrl: string; token: string } | null> {
  const connection = instanceUrl
    ? await prisma.canvasConnection.findFirst({ where: { userId, canvasInstanceUrl: instanceUrl } })
    : await prisma.canvasConnection.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
  if (!connection) return null
  return { canvasInstanceUrl: connection.canvasInstanceUrl, token: decryptPassword(connection.encryptedToken) }
}

// ── GET /dashboard ───────────────────────────────────────────────────────────
// Returns to-do items + courses with grades for a specific Canvas instance.

router.get(
  '/dashboard',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined

    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    const { canvasInstanceUrl, token } = conn

    const [todo, courses] = await Promise.all([
      fetchCanvasTodo(canvasInstanceUrl, token).catch(() => []),
      fetchCanvasCoursesWithGrades(canvasInstanceUrl, token).catch(() => []),
    ])

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_DASHBOARD', action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: { canvasInstanceUrl, todo, courses } })
  }),
)

// ── GET /courses/:courseId/modules ───────────────────────────────────────────

router.get(
  '/courses/:courseId/modules',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined

    if (isNaN(courseId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId' } })
      return
    }

    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    const modules = await fetchCanvasModules(conn.canvasInstanceUrl, conn.token, courseId)

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_MODULES', resourceId: String(courseId), action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: modules })
  }),
)

// ── GET /courses/:courseId/announcements ─────────────────────────────────────

router.get(
  '/courses/:courseId/announcements',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined

    if (isNaN(courseId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId' } })
      return
    }

    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    const announcements = await fetchCanvasAnnouncements(conn.canvasInstanceUrl, conn.token, courseId)

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_ANNOUNCEMENTS', resourceId: String(courseId), action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: announcements })
  }),
)

// ── GET /courses/:courseId/assignments/:assignmentId ─────────────────────────

router.get(
  '/courses/:courseId/assignments/:assignmentId',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const assignmentId = parseInt(req.params.assignmentId)
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined

    if (isNaN(courseId) || isNaN(assignmentId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId or assignmentId' } })
      return
    }

    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    const assignment = await fetchCanvasAssignmentDetail(conn.canvasInstanceUrl, conn.token, courseId, assignmentId)

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_ASSIGNMENT', resourceId: String(assignmentId), action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: assignment })
  }),
)

// ── GET /courses/:courseId/files ─────────────────────────────────────────────

router.get(
  '/courses/:courseId/files',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined

    if (isNaN(courseId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId' } })
      return
    }

    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    const files = await fetchCanvasCourseFiles(conn.canvasInstanceUrl, conn.token, courseId)

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_FILES', resourceId: String(courseId), action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: files })
  }),
)

// ── GET /courses/:courseId/pages/:pageSlug ──────────────────────────────────

router.get(
  '/courses/:courseId/pages/:pageSlug',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const pageSlug = req.params.pageSlug
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined

    if (isNaN(courseId) || !pageSlug) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId or pageSlug' } })
      return
    }

    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    const page = await fetchCanvasPage(conn.canvasInstanceUrl, conn.token, courseId, pageSlug)

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_PAGE', resourceId: pageSlug, action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: page })
  }),
)

// ── POST /courses/:courseId/assignments/:assignmentId/submit ─────────────────

router.post(
  '/courses/:courseId/assignments/:assignmentId/submit',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const assignmentId = parseInt(req.params.assignmentId)
    const { submissionType, body, url, canvasInstanceUrl } = req.body as {
      submissionType?: string; body?: string; url?: string; canvasInstanceUrl?: string
    }

    if (isNaN(courseId) || isNaN(assignmentId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId or assignmentId' } }); return
    }
    if (submissionType !== 'online_text_entry' && submissionType !== 'online_url') {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'submissionType must be online_text_entry or online_url' } }); return
    }
    if (submissionType === 'online_text_entry' && !body?.trim()) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'body is required for text submissions' } }); return
    }
    if (submissionType === 'online_url' && !url?.trim()) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'url is required for URL submissions' } }); return
    }

    const conn = await resolveConnection(userId, canvasInstanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } }); return
    }

    await submitCanvasAssignment(conn.canvasInstanceUrl, conn.token, courseId, assignmentId, {
      submission_type: submissionType as 'online_text_entry' | 'online_url',
      body,
      url,
    })

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_ASSIGNMENT', resourceId: String(assignmentId), action: 'CANVAS_SUBMIT', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: { ok: true } })
  }),
)

// ── GET /courses/:courseId/discussions/:topicId ──────────────────────────────

router.get(
  '/courses/:courseId/discussions/:topicId',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const topicId = parseInt(req.params.topicId)
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined
    if (isNaN(courseId) || isNaN(topicId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId or topicId' } }); return
    }
    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) { res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } }); return }
    const [topic, view] = await Promise.all([
      fetchCanvasDiscussionTopic(conn.canvasInstanceUrl, conn.token, courseId, topicId),
      fetchCanvasDiscussionView(conn.canvasInstanceUrl, conn.token, courseId, topicId),
    ])
    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_DISCUSSION', resourceId: String(topicId), action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })
    res.json({ data: { topic, view } })
  }),
)

// ── POST /courses/:courseId/discussions/:topicId/entries ─────────────────────

router.post(
  '/courses/:courseId/discussions/:topicId/entries',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const topicId = parseInt(req.params.topicId)
    const { message, parentEntryId, canvasInstanceUrl } = req.body as { message?: string; parentEntryId?: number; canvasInstanceUrl?: string }
    if (isNaN(courseId) || isNaN(topicId) || !message?.trim()) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid params or empty message' } }); return
    }
    const conn = await resolveConnection(userId, canvasInstanceUrl)
    if (!conn) { res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } }); return }
    const entry = await postCanvasDiscussionEntry(conn.canvasInstanceUrl, conn.token, courseId, topicId, message, parentEntryId)
    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_DISCUSSION', resourceId: String(topicId), action: 'CANVAS_SUBMIT', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })
    res.json({ data: entry })
  }),
)

// ── GET /courses/:courseId/quizzes/:quizId ────────────────────────────────────

router.get(
  '/courses/:courseId/quizzes/:quizId',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const quizId = parseInt(req.params.quizId)
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined
    if (isNaN(courseId) || isNaN(quizId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId or quizId' } }); return
    }
    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) { res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } }); return }
    const [quiz, questions, submissions] = await Promise.all([
      fetchCanvasQuizDetail(conn.canvasInstanceUrl, conn.token, courseId, quizId),
      fetchCanvasQuizQuestions(conn.canvasInstanceUrl, conn.token, courseId, quizId),
      fetchCanvasQuizSubmissions(conn.canvasInstanceUrl, conn.token, courseId, quizId),
    ])
    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_QUIZ', resourceId: String(quizId), action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })
    res.json({ data: { quiz, questions, submissions } })
  }),
)

// ── POST /courses/:courseId/quizzes/:quizId/submissions ──────────────────────
// Start a new quiz attempt. Returns the active submission + validation_token.

router.post(
  '/courses/:courseId/quizzes/:quizId/submissions',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const quizId = parseInt(req.params.quizId)
    const { canvasInstanceUrl } = req.body as { canvasInstanceUrl?: string }

    if (isNaN(courseId) || isNaN(quizId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId or quizId' } })
      return
    }

    const conn = await resolveConnection(userId, canvasInstanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    const submission = await startCanvasQuizSubmission(conn.canvasInstanceUrl, conn.token, courseId, quizId)

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_QUIZ', resourceId: String(quizId), action: 'CANVAS_QUIZ_START', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: submission })
  }),
)

// ── GET /courses/:courseId/quizzes/:quizId/submissions/:submissionId/questions ─
// Fetch questions for an active (in-progress) quiz submission.

router.get(
  '/courses/:courseId/quizzes/:quizId/submissions/:submissionId/questions',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const quizId = parseInt(req.params.quizId)
    const submissionId = parseInt(req.params.submissionId)
    const instanceUrl = req.query.canvasInstanceUrl as string | undefined
    const validationToken = req.query.validationToken as string | undefined

    if (isNaN(courseId) || isNaN(quizId) || isNaN(submissionId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId, quizId, or submissionId' } })
      return
    }
    if (!validationToken) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'validationToken query param is required' } })
      return
    }

    const conn = await resolveConnection(userId, instanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    const questions = await fetchCanvasSubmissionQuestions(conn.canvasInstanceUrl, conn.token, courseId, quizId, submissionId, validationToken)

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_QUIZ', resourceId: String(quizId), action: 'CANVAS_VIEW', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: questions })
  }),
)

// ── PUT /courses/:courseId/quizzes/:quizId/submissions/:submissionId/questions ─
// Save (auto-backup) answers for an in-progress quiz submission.

router.put(
  '/courses/:courseId/quizzes/:quizId/submissions/:submissionId/questions',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const quizId = parseInt(req.params.quizId)
    const submissionId = parseInt(req.params.submissionId)
    const { validationToken, attempt, quizQuestions, canvasInstanceUrl } = req.body as {
      validationToken?: string
      attempt?: number
      quizQuestions?: Array<{ id: number; flagged: boolean; answer: unknown }>
      canvasInstanceUrl?: string
    }

    if (isNaN(courseId) || isNaN(quizId) || isNaN(submissionId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId, quizId, or submissionId' } })
      return
    }
    if (!validationToken || attempt === undefined || !quizQuestions) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'validationToken, attempt, and quizQuestions are required' } })
      return
    }

    const conn = await resolveConnection(userId, canvasInstanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    await saveCanvasQuizAnswers(conn.canvasInstanceUrl, conn.token, courseId, quizId, submissionId, validationToken, attempt, quizQuestions)

    res.json({ data: { ok: true } })
  }),
)

// ── POST /courses/:courseId/quizzes/:quizId/submissions/:submissionId/complete ─
// Complete (submit) an in-progress quiz submission.

router.post(
  '/courses/:courseId/quizzes/:quizId/submissions/:submissionId/complete',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const courseId = parseInt(req.params.courseId)
    const quizId = parseInt(req.params.quizId)
    const submissionId = parseInt(req.params.submissionId)
    const { validationToken, attempt, canvasInstanceUrl } = req.body as {
      validationToken?: string
      attempt?: number
      canvasInstanceUrl?: string
    }

    if (isNaN(courseId) || isNaN(quizId) || isNaN(submissionId)) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid courseId, quizId, or submissionId' } })
      return
    }
    if (!validationToken || attempt === undefined) {
      res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'validationToken and attempt are required' } })
      return
    }

    const conn = await resolveConnection(userId, canvasInstanceUrl)
    if (!conn) {
      res.status(404).json({ data: null, error: { code: 'NOT_CONNECTED', message: 'No Canvas account connected.' } })
      return
    }

    await completeCanvasQuizSubmission(conn.canvasInstanceUrl, conn.token, courseId, quizId, submissionId, validationToken, attempt)

    await prisma.complianceAuditLog.create({
      data: { userId, resourceType: 'CANVAS_QUIZ', resourceId: String(quizId), action: 'CANVAS_QUIZ_SUBMIT', ipAddress: req.ip ?? 'unknown', timestamp: new Date() },
    })

    res.json({ data: { ok: true } })
  }),
)

// ── POST /refresh-token ──────────────────────────────────────────────────────
// Accepts a new Canvas token for an instance whose token has expired.
// Verifies it against Canvas before saving and clears tokenInvalid.

router.post(
  '/refresh-token',
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId!
    const { canvasInstanceUrl, newToken } = req.body as {
      canvasInstanceUrl?: string
      newToken?: string
    }

    if (!canvasInstanceUrl || !newToken) {
      res.status(400).json({
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'canvasInstanceUrl and newToken are required.' },
      })
      return
    }

    let self: Awaited<ReturnType<typeof verifyCanvasToken>>
    try {
      self = await verifyCanvasToken(canvasInstanceUrl, newToken)
    } catch (err) {
      if (err instanceof CanvasTokenError) {
        res.status(401).json({
          data: null,
          error: { code: 'INVALID_TOKEN', message: 'The token you provided is invalid. Please check and try again.' },
        })
      } else {
        res.status(502).json({
          data: null,
          error: { code: 'CANVAS_UNREACHABLE', message: 'Could not reach Canvas to verify the token. Please try again.' },
        })
      }
      return
    }

    const encryptedToken = encryptPassword(newToken)

    await prisma.canvasConnection.update({
      where: { userId_canvasInstanceUrl: { userId, canvasInstanceUrl } },
      data: {
        encryptedToken,
        tokenInvalid: false,
        canvasUserId: String(self.id),
        canvasUserName: self.name,
      },
    })

    logger.info('Canvas token refreshed', { userId, canvasInstanceUrl })

    res.json({ data: { success: true } })
  }),
)

export default router