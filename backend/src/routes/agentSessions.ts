/**
 * Agent session REST endpoints.
 *
 * All routes: auth-guarded (requireAuth applied at mount point in app.ts),
 * user-scoped (ownership validated before any data is returned),
 * { data, meta?, error? } response shape, correct HTTP status codes.
 *
 * Rate limiting: the global aiLimiter is applied at the /ai/agent mount
 * point in app.ts — same as the rest of the AI routes.
 */

import { Router, Response } from 'express'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { writeAuditLog } from '../lib/auditLog'
import { logger } from '../common/logger'
import { startSession, completeSession, AgentModule } from '../services/agent/agentExecution.service'
import { runAgentOrchestrator } from '../services/agent/agentOrchestrator'

const router = Router()

// ── Input schemas ─────────────────────────────────────────────────────────────

const CreateSessionSchema = z.object({
  module: z.enum(['PLANNER', 'GPA', 'ROADMAP', 'CHAT']),
  userMessage: z.string().min(1).max(2000).optional(),
}).strict()

const ListSessionsQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  module: z.enum(['PLANNER', 'GPA', 'ROADMAP', 'CHAT']).optional(),
}).strict()

const ConfirmSchema = z.object({
  confirmed: z.boolean(),
}).strict()

const SessionIdParamSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
})

// ── Helper — resolve userId or return 401 ────────────────────────────────────

function resolveUserId(req: AuthRequest, res: Response): number | null {
  if (req.userId === undefined) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    return null
  }
  return req.userId
}

// ── POST /ai/agent/session ────────────────────────────────────────────────────

router.post('/session', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = resolveUserId(req, res)
  if (userId === null) return

  const parsed = CreateSessionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(422).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
    })
    return
  }

  const ipAddress = req.ip ?? 'unknown'

  try {
    const result = await startSession(
      userId,
      parsed.data.module as AgentModule,
      'USER',
      parsed.data.userMessage,
      ipAddress,
    )

    if (result.blockedReason === 'COPPA_GATE') {
      res.status(403).json({
        data: null,
        error: {
          code: 'COPPA_BLOCKED',
          message: 'Parental consent is required before using AI features for users under 13.',
        },
      })
      return
    }

    if (result.blockedReason === 'SKIPPED_FLAG_OFF') {
      // Should not happen for USER trigger, but guard defensively
      res.status(503).json({
        data: null,
        error: { code: 'FEATURE_DISABLED', message: 'Autonomous AI features are not enabled.' },
      })
      return
    }

    // Keep the serverless function alive until the orchestration loop settles.
    // Without waitUntil(), Vercel may freeze or terminate the execution context
    // as soon as the HTTP response is sent, cutting off the in-flight LLM calls
    // and DB writes — leaving the session stuck in RUNNING forever.
    // waitUntil() is a no-op in non-Vercel runtimes, so local development is unaffected.
    waitUntil(
      runAgentOrchestrator({
        sessionId: result.sessionId,
        userId,
        module: parsed.data.module as AgentModule,
        trigger: 'USER',
        userMessage: parsed.data.userMessage ?? '',
        ipAddress,
      }).catch(err => {
        logger.error('agent_orchestrator_unhandled', {
          sessionId: result.sessionId,
          errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
        })
      }),
    )

    res.status(201).json({
      data: { sessionId: result.sessionId, status: 'RUNNING' },
    })
  } catch (err) {
    logger.error('agent_session_create_error', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

// ── GET /ai/agent/sessions ────────────────────────────────────────────────────

router.get('/sessions', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = resolveUserId(req, res)
  if (userId === null) return

  const parsed = ListSessionsQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(422).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
    })
    return
  }

  const { cursor, limit, module } = parsed.data

  try {
    await writeAuditLog({
      userId,
      resourceType: 'AGENT_SESSION',
      resourceId: String(userId),
      action: 'LIST_AGENT_SESSIONS',
      ipAddress: req.ip ?? 'unknown',
    })

    const sessions = await prisma.agentSession.findMany({
      where: {
        userId,
        ...(module !== undefined && { module }),
      },
      orderBy: { startedAt: 'desc' },
      take: limit + 1,
      ...(cursor !== undefined && { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        module: true,
        trigger: true,
        status: true,
        toolCallCount: true,
        startedAt: true,
        completedAt: true,
        userMessage: true,
      },
    })

    const hasNextPage = sessions.length > limit
    const page = hasNextPage ? sessions.slice(0, limit) : sessions
    const nextCursor = hasNextPage ? page[page.length - 1]!.id : null

    res.status(200).json({
      data: page,
      meta: { nextCursor, hasNextPage },
    })
  } catch (err) {
    logger.error('agent_sessions_list_error', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

// ── GET /ai/agent/sessions/:sessionId ────────────────────────────────────────

router.get('/sessions/:sessionId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = resolveUserId(req, res)
  if (userId === null) return

  const paramParsed = SessionIdParamSchema.safeParse(req.params)
  if (!paramParsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_PARAM', message: 'Invalid sessionId' } })
    return
  }

  try {
    const session = await prisma.agentSession.findFirst({
      where: { id: paramParsed.data.sessionId, userId },
      select: {
        id: true,
        module: true,
        trigger: true,
        status: true,
        toolCallCount: true,
        maxToolCalls: true,
        userMessage: true,
        finalResponse: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
      },
    })

    if (session === null) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Session not found' } })
      return
    }

    await writeAuditLog({
      userId,
      resourceType: 'AGENT_SESSION',
      resourceId: String(session.id),
      action: 'READ_AGENT_SESSION',
      ipAddress: req.ip ?? 'unknown',
    })

    res.status(200).json({ data: session })
  } catch (err) {
    logger.error('agent_session_get_error', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

// ── GET /ai/agent/sessions/:sessionId/tool-calls ─────────────────────────────

router.get('/sessions/:sessionId/tool-calls', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = resolveUserId(req, res)
  if (userId === null) return

  const paramParsed = SessionIdParamSchema.safeParse(req.params)
  if (!paramParsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_PARAM', message: 'Invalid sessionId' } })
    return
  }

  try {
    // Ownership check: session must belong to this user
    const session = await prisma.agentSession.findFirst({
      where: { id: paramParsed.data.sessionId, userId },
      select: { id: true },
    })

    if (session === null) {
      res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Session not found' } })
      return
    }

    const toolCalls = await prisma.agentToolCall.findMany({
      where: { sessionId: session.id },
      orderBy: { executedAt: 'asc' },
      select: {
        id: true,
        toolName: true,
        toolInput: true,
        toolOutput: true,
        status: true,
        denialReason: true,
        executedAt: true,
        durationMs: true,
      },
    })

    await writeAuditLog({
      userId,
      resourceType: 'AGENT_TOOL_CALL',
      resourceId: String(session.id),
      action: 'LIST_TOOL_CALLS',
      ipAddress: req.ip ?? 'unknown',
    })

    res.status(200).json({ data: toolCalls })
  } catch (err) {
    logger.error('agent_tool_calls_list_error', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

// ── POST /ai/agent/sessions/:sessionId/confirm ───────────────────────────────
//
// Write-tool confirmation gating. Accepts a {confirmed: boolean} signal and
// stores it on the session so the ai-engineer's orchestrator can consume it.
// The orchestrator (Tasks 7-9, ai-engineer) will poll or be signaled when
// confirmed=true to resume the agentic loop with the approved write.

router.post('/sessions/:sessionId/confirm', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = resolveUserId(req, res)
  if (userId === null) return

  const paramParsed = SessionIdParamSchema.safeParse(req.params)
  if (!paramParsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_PARAM', message: 'Invalid sessionId' } })
    return
  }

  const bodyParsed = ConfirmSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(422).json({
      data: null,
      error: { code: 'VALIDATION_ERROR', details: bodyParsed.error.flatten() },
    })
    return
  }

  try {
    // Ownership check
    const session = await prisma.agentSession.findFirst({
      where: { id: paramParsed.data.sessionId, userId, status: 'RUNNING' },
      select: { id: true },
    })

    if (session === null) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: 'Active session not found' },
      })
      return
    }

    const { confirmed } = bodyParsed.data

    if (!confirmed) {
      // User rejected — mark session failed and create a DENIED tool call record
      await completeSession(session.id, 'User rejected the pending write action.', 'FAILED')

      await prisma.agentToolCall.create({
        data: {
          sessionId: session.id,
          toolName: 'write_confirmation',
          toolInput: { confirmed: false } as Prisma.InputJsonValue,
          toolOutput: Prisma.JsonNull,
          status: 'DENIED',
          denialReason: 'USER_REJECTED',
        },
      })

      await writeAuditLog({
        userId,
        resourceType: 'AGENT_SESSION',
        resourceId: String(session.id),
        action: 'USER_REJECTED_WRITE',
        ipAddress: req.ip ?? 'unknown',
      })
    } else {
      // Bug 6 fix: idempotency guard — at most one PENDING write_confirmation
      // may exist per session. A unique partial index on the DB enforces this at
      // the storage layer (see startup.ts patch). This application-level check
      // returns 409 immediately so concurrent callers get a deterministic error
      // rather than racing to insert and relying on the constraint alone.
      const existingPending = await prisma.agentToolCall.findFirst({
        where: {
          sessionId: session.id,
          toolName: 'write_confirmation',
          status: 'PENDING',
        },
        select: { id: true },
      })

      if (existingPending !== null) {
        res.status(409).json({
          data: null,
          error: {
            code: 'CONFIRM_ALREADY_PENDING',
            message: 'A pending write confirmation already exists for this session.',
          },
        })
        return
      }

      // Confirmed — store signal for the orchestrator to consume.
      // ai-engineer (Tasks 7-9) will implement the consumption side.
      // For now we record a PENDING tool call as the signal.
      await prisma.agentToolCall.create({
        data: {
          sessionId: session.id,
          toolName: 'write_confirmation',
          toolInput: { confirmed: true } as Prisma.InputJsonValue,
          toolOutput: Prisma.JsonNull,
          status: 'PENDING',
          denialReason: null,
        },
      })

      await writeAuditLog({
        userId,
        resourceType: 'AGENT_SESSION',
        resourceId: String(session.id),
        action: 'USER_CONFIRMED_WRITE',
        ipAddress: req.ip ?? 'unknown',
      })
    }

    res.status(200).json({ data: { sessionId: session.id, confirmed } })
  } catch (err) {
    logger.error('agent_confirm_error', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

export default router
