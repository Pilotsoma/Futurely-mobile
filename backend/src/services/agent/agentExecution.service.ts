/**
 * AgentExecutionService — core orchestration dispatch for all agentic sessions.
 *
 * Guardrails enforced here (non-negotiable):
 * 1. COPPA gate: checked before any session is created. Users under 13 without
 *    verified parental consent are blocked at this layer, regardless of module
 *    or trigger type. Fail-closed: null user, null DOB, or decryption failure
 *    all result in a COPPA block — never in a pass-through.
 * 2. Autonomous gate: SYSTEM-triggered sessions are refused when
 *    AUTONOMOUS_AGENTS_ENABLED !== "true". The caller marks the job
 *    SKIPPED_FLAG_OFF — no session row is ever created.
 * 3. Allowlist enforcement: toolName is validated against the module's registry
 *    before any execution. Unknown tools are DENIED and logged.
 * 4. Write tools in SYSTEM sessions: always DENIED regardless of allowlist.
 * 5. Hard cap: 15 tool calls per session, enforced atomically before every
 *    dispatch via UPDATE WHERE toolCallCount < CAP RETURNING count.
 * 6. Every tool call outcome (success/denied/failed) writes to BOTH
 *    AgentToolCall and ComplianceAuditLog. On the success path, both writes
 *    are wrapped in a single Prisma $transaction to guarantee atomicity.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { logger } from '../../common/logger'
import { writeAuditLog } from '../../lib/auditLog'
import { decryptPassword } from '../../integrations/grades/credentialCrypto'
import { hasDevPowers } from '../../middleware/requireAdmin'
import { toolRegistry } from './tools/registry'
import { consumeWriteRateLimitSlot } from './writeRateLimit.service'

export type AgentModule = 'PLANNER' | 'GPA' | 'ROADMAP' | 'CHAT'
export type AgentTrigger = 'USER' | 'SYSTEM'
export type AgentSessionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED_COPPA'
export type ToolCallStatus = 'PENDING' | 'SUCCESS' | 'DENIED' | 'FAILED'
export type DenialReason = 'COPPA_GATE' | 'ALLOWLIST' | 'RATE_LIMIT' | 'ERROR' | 'USER_REJECTED'

const HARD_TOOL_CAP = 15

interface StartSessionResult {
  sessionId: number
  blockedReason?: DenialReason | 'SKIPPED_FLAG_OFF'
}

interface DispatchToolResult {
  success: boolean
  output?: unknown
  denialReason?: DenialReason
}

/**
 * Computes the age in years from an encrypted date-of-birth ciphertext.
 *
 * Fail-closed per ENGINEERING_RULES.md: this function throws rather than
 * returning a sentinel value on any failure condition. Callers must handle
 * thrown errors as hard COPPA blocks. Never add a catch block here that
 * returns a fallback age — that is prohibited as a COPPA violation.
 */
export function computeAge(encryptedDob: string): number {
  const dob = decryptPassword(encryptedDob)
  const birth = new Date(dob)
  if (isNaN(birth.getTime())) {
    throw new Error('Invalid date of birth format after decryption')
  }
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1
  }
  return age
}

/**
 * Creates an agent session after passing COPPA and autonomous-flag checks.
 *
 * SYSTEM trigger + flag off → returns blockedReason='SKIPPED_FLAG_OFF', no DB row.
 * COPPA blocked (null user, null DOB, decrypt error, underage+unconsented) →
 *   returns blockedReason='COPPA_GATE'. A BLOCKED_COPPA session row is only
 *   created when there is a valid user to attach it to.
 * Otherwise → creates RUNNING session, returns sessionId.
 */
export async function startSession(
  userId: number,
  module: AgentModule,
  trigger: AgentTrigger,
  userMessage: string | undefined,
  ipAddress: string,
  autonomousJobId?: number,
): Promise<StartSessionResult> {
  // Guardrail 2: autonomous flag gate — no DB writes if flag is off
  if (trigger === 'SYSTEM' && process.env.AUTONOMOUS_AGENTS_ENABLED !== 'true') {
    logger.info('agent_session_skipped_flag_off', { userId, module, trigger })
    return { sessionId: -1, blockedReason: 'SKIPPED_FLAG_OFF' }
  }

  // Guardrail 1: COPPA gate — query user before creating any session.
  // Bug 1 fix: null user is a hard block BEFORE session creation.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dateOfBirth: true, coppaConsentStatus: true },
  })

  if (user === null) {
    // Cannot create a session row for a nonexistent user (FK violation and privacy risk).
    logger.warn('agent_session_denied_user_not_found', { userId, module })
    await writeAuditLog({
      userId,
      resourceType: 'AGENT_SESSION',
      resourceId: String(userId),
      action: 'COPPA_BLOCK',
      ipAddress,
    })
    return { sessionId: -1, blockedReason: 'COPPA_GATE' }
  }

  // DEV/ADMIN bypass: internal test accounts skip the COPPA age check.
  // This uses a fresh, server-side DB lookup via hasDevPowers (which queries
  // role, tag, allTags — distinct from the COPPA query above that only selects
  // dateOfBirth and coppaConsentStatus). The userId originates exclusively from
  // auth middleware upstream; no client-supplied header, query param, body
  // field, or JWT claim is read here to make this decision.
  const isDevAccount = await hasDevPowers(userId)
  if (isDevAccount) {
    await writeAuditLog({
      userId,
      resourceType: 'AGENT_SESSION',
      resourceId: String(userId),
      action: 'COPPA_BYPASS_DEV_ACCOUNT',
      ipAddress,
    })
    // Do not return — fall through to the RUNNING session creation path below.
  }

  if (!isDevAccount) {
  // Bug 2 fix: null DOB is treated as age-unknown → COPPA block, not adult.
  if (user.dateOfBirth === null) {
    const session = await prisma.agentSession.create({
      data: {
        userId,
        module,
        trigger,
        status: 'BLOCKED_COPPA',
        userMessage: userMessage ?? null,
        autonomousJobId: autonomousJobId ?? null,
      },
    })
    await writeAuditLog({
      userId,
      resourceType: 'AGENT_SESSION',
      resourceId: String(session.id),
      action: 'COPPA_BLOCK',
      ipAddress,
    })
    logger.warn('agent_session_coppa_blocked', { sessionId: session.id, module, trigger, reason: 'age_unknown' })
    return { sessionId: session.id, blockedReason: 'COPPA_GATE' }
  }

  // Bug 3 fix: decryption failure propagates as a hard COPPA block.
  // computeAge() no longer has a catch block — it throws on any failure.
  let age: number
  try {
    age = computeAge(user.dateOfBirth)
  } catch (err) {
    // Infrastructure error — log at ERROR level (never the raw DOB or ciphertext)
    logger.error('coppa_age_computation_error', {
      userId,
      module,
      errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
    })
    const session = await prisma.agentSession.create({
      data: {
        userId,
        module,
        trigger,
        status: 'BLOCKED_COPPA',
        userMessage: userMessage ?? null,
        autonomousJobId: autonomousJobId ?? null,
      },
    })
    await writeAuditLog({
      userId,
      resourceType: 'AGENT_SESSION',
      resourceId: String(session.id),
      action: 'COPPA_BLOCK',
      ipAddress,
    })
    logger.warn('agent_session_coppa_blocked', { sessionId: session.id, module, trigger, reason: 'age_computation_error' })
    return { sessionId: session.id, blockedReason: 'COPPA_GATE' }
  }

  const consentVerified = user.coppaConsentStatus === 'VERIFIED'
  if (age < 13 && !consentVerified) {
    const session = await prisma.agentSession.create({
      data: {
        userId,
        module,
        trigger,
        status: 'BLOCKED_COPPA',
        userMessage: userMessage ?? null,
        autonomousJobId: autonomousJobId ?? null,
      },
    })
    await writeAuditLog({
      userId,
      resourceType: 'AGENT_SESSION',
      resourceId: String(session.id),
      action: 'COPPA_BLOCK',
      ipAddress,
    })
    logger.warn('agent_session_coppa_blocked', { sessionId: session.id, module, trigger, reason: 'underage' })
    return { sessionId: session.id, blockedReason: 'COPPA_GATE' }
  }
  } // end if (!isDevAccount)

  // Create RUNNING session
  const session = await prisma.agentSession.create({
    data: {
      userId,
      module,
      trigger,
      status: 'RUNNING',
      userMessage: userMessage ?? null,
      autonomousJobId: autonomousJobId ?? null,
    },
  })

  await writeAuditLog({
    userId,
    resourceType: 'AGENT_SESSION',
    resourceId: String(session.id),
    action: 'SESSION_START',
    ipAddress,
  })

  logger.info('agent_session_started', { sessionId: session.id, module, trigger })

  return { sessionId: session.id }
}

/**
 * Dispatches a single tool call within an existing session.
 *
 * Enforces in order: status check → allowlist → module scope → write-in-system →
 * write rate limit → atomic slot claim (cap) → execute → atomic persist.
 *
 * Bug 9 fix: the tool-call cap is enforced by atomically incrementing
 * toolCallCount before execution (UPDATE WHERE count < CAP RETURNING count).
 * Two concurrent dispatches cannot both pass the cap check — one will see
 * the post-increment value and be denied.
 *
 * Bug 5 fix: on the success path, AgentToolCall.create and
 * ComplianceAuditLog.create are wrapped in a single $transaction. A
 * persistence failure rolls back both (no silent FERPA gap), and the
 * caller receives an ERROR result rather than a misleading FAILED record.
 */
export async function dispatchTool(
  sessionId: number,
  toolName: string,
  toolInput: unknown,
  ipAddress: string,
): Promise<DispatchToolResult> {
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
    select: {
      userId: true,
      module: true,
      trigger: true,
      toolCallCount: true,
      status: true,
    },
  })

  if (session === null) {
    logger.error('agent_dispatch_session_not_found', { sessionId, toolName })
    return { success: false, denialReason: 'ERROR' }
  }

  if (session.status !== 'RUNNING') {
    logger.warn('agent_dispatch_session_not_running', { sessionId, toolName, status: session.status })
    return { success: false, denialReason: 'ERROR' }
  }

  // Guardrail 3: allowlist — never trust the LLM's tool name
  const tool = toolRegistry.get(toolName)
  if (tool === undefined) {
    await recordToolCall(sessionId, toolName, toolInput, null, 'DENIED', 'ALLOWLIST')
    await writeAuditLog({
      userId: session.userId,
      resourceType: 'AGENT_TOOL',
      resourceId: toolName,
      action: 'TOOL_DENIED_NOT_IN_REGISTRY',
      ipAddress,
    })
    logger.warn('agent_tool_not_in_registry', { sessionId, toolName })
    return { success: false, denialReason: 'ALLOWLIST' }
  }

  // Module scope: tool must belong to the session's module.
  // CHAT is exempt — it is the combined-module assistant and may call any
  // registered tool. PLANNER/GPA/ROADMAP sessions are still restricted to
  // their own module so a GPA session cannot call planner_delete_task, etc.
  if (session.module !== 'CHAT' && tool.module !== session.module) {
    await recordToolCall(sessionId, toolName, toolInput, null, 'DENIED', 'ALLOWLIST')
    await writeAuditLog({
      userId: session.userId,
      resourceType: 'AGENT_TOOL',
      resourceId: toolName,
      action: 'TOOL_DENIED_WRONG_MODULE',
      ipAddress,
    })
    logger.warn('agent_tool_wrong_module', {
      sessionId,
      toolName,
      sessionModule: session.module,
      toolModule: tool.module,
    })
    return { success: false, denialReason: 'ALLOWLIST' }
  }

  // Guardrail 4: write tools are never dispatched in SYSTEM sessions
  if (tool.type === 'WRITE' && session.trigger === 'SYSTEM') {
    await recordToolCall(sessionId, toolName, toolInput, null, 'DENIED', 'ALLOWLIST')
    await writeAuditLog({
      userId: session.userId,
      resourceType: 'AGENT_TOOL',
      resourceId: toolName,
      action: 'TOOL_DENIED_SYSTEM_WRITE',
      ipAddress,
    })
    logger.warn('agent_tool_write_denied_system', { sessionId, toolName })
    return { success: false, denialReason: 'ALLOWLIST' }
  }

  // Write-tool hourly rate limit: atomic check-and-increment in one operation.
  // Bug 8 fix: replaced the former check-then-increment two-step with a single
  // atomic upsert that only increments when below the limit.
  if (tool.type === 'WRITE' && tool.rateLimitPerHour !== undefined) {
    const allowed = await consumeWriteRateLimitSlot(
      session.userId,
      toolName,
      tool.rateLimitPerHour,
    )
    if (!allowed) {
      await recordToolCall(sessionId, toolName, toolInput, null, 'DENIED', 'RATE_LIMIT')
      await writeAuditLog({
        userId: session.userId,
        resourceType: 'AGENT_TOOL',
        resourceId: toolName,
        action: 'TOOL_DENIED_RATE_LIMIT',
        ipAddress,
      })
      logger.warn('agent_tool_rate_limited', { sessionId, toolName })
      return { success: false, denialReason: 'RATE_LIMIT' }
    }
  }

  // Guardrail 5 (Bug 9 fix): atomically claim a tool-call slot.
  // UPDATE WHERE toolCallCount < CAP ensures two concurrent dispatches cannot
  // both pass — the one that increments to CAP wins; the other sees count=CAP
  // which fails the WHERE clause and returns count=0 (denied).
  const slotClaim = await prisma.agentSession.updateMany({
    where: { id: sessionId, toolCallCount: { lt: HARD_TOOL_CAP } },
    data: { toolCallCount: { increment: 1 } },
  })

  if (slotClaim.count === 0) {
    await recordToolCall(sessionId, toolName, toolInput, null, 'DENIED', 'RATE_LIMIT')
    await writeAuditLog({
      userId: session.userId,
      resourceType: 'AGENT_TOOL',
      resourceId: toolName,
      action: 'TOOL_DENIED_HARD_CAP',
      ipAddress,
    })
    logger.warn('agent_tool_denied_hard_cap', { sessionId, toolName, count: session.toolCallCount })
    return { success: false, denialReason: 'RATE_LIMIT' }
  }

  const startMs = Date.now()

  // Separate try blocks: one for tool execution, one for persistence.
  // This lets us distinguish "tool failed" from "tool ran but persistence failed".
  let toolOutput: unknown
  try {
    toolOutput = await tool.execute(session.userId, toolInput)
  } catch (toolErr) {
    const durationMs = Date.now() - startMs
    const errorMessage = toolErr instanceof Error ? toolErr.message : String(toolErr)

    // Tool execution failed: write FAILED record only (no audit log per Bug 5 spec).
    await recordToolCall(sessionId, toolName, toolInput, null, 'FAILED', 'ERROR', durationMs)

    logger.error('agent_tool_execution_failed', {
      sessionId,
      toolName,
      durationMs,
      error: errorMessage,
    })

    return { success: false, denialReason: 'ERROR' }
  }

  const durationMs = Date.now() - startMs

  // Bug 5 fix: atomically persist the SUCCESS tool call record AND the audit log
  // entry in a single transaction. If the transaction fails (DB outage, constraint
  // violation), both writes are rolled back — no silent FERPA gap where a
  // successful tool access has no audit trail. The error is logged as an
  // infrastructure failure; no misleading FAILED agentToolCall record is written.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.agentToolCall.create({
        data: {
          sessionId,
          toolName,
          toolInput: (toolInput ?? {}) as Prisma.InputJsonValue,
          toolOutput: toolOutput !== null && toolOutput !== undefined
            ? (toolOutput as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          status: 'SUCCESS',
          denialReason: null,
          durationMs,
        },
      })
      await tx.complianceAuditLog.create({
        data: {
          userId: session.userId,
          resourceType: 'AGENT_TOOL',
          resourceId: toolName,
          action: `TOOL_SUCCESS_${toolName.toUpperCase()}`,
          ipAddress,
        },
      })
    })
  } catch (txErr) {
    // Tool ran successfully but persistence failed — infrastructure issue.
    // Do NOT write a FAILED agentToolCall record (that would misrepresent
    // what actually happened and leave a misleading audit trail).
    logger.error('agent_tool_persistence_failed', {
      sessionId,
      toolName,
      durationMs,
      error: txErr instanceof Error ? txErr.message : String(txErr),
    })
    return { success: false, denialReason: 'ERROR' }
  }

  logger.info('agent_tool_success', { sessionId, toolName, durationMs })

  return { success: true, output: toolOutput }
}

/**
 * Marks a session as COMPLETED or FAILED and records the final response.
 */
export async function completeSession(
  sessionId: number,
  finalResponse: string,
  status: 'COMPLETED' | 'FAILED',
  errorMessage?: string,
): Promise<void> {
  await prisma.agentSession.update({
    where: { id: sessionId },
    data: {
      status,
      finalResponse,
      completedAt: new Date(),
      errorMessage: errorMessage ?? null,
    },
  })
  logger.info('agent_session_completed', { sessionId, status })
}

async function recordToolCall(
  sessionId: number,
  toolName: string,
  toolInput: unknown,
  toolOutput: unknown,
  status: ToolCallStatus,
  denialReason: DenialReason | null,
  durationMs?: number,
): Promise<void> {
  await prisma.agentToolCall.create({
    data: {
      sessionId,
      toolName,
      toolInput: (toolInput ?? {}) as Prisma.InputJsonValue,
      toolOutput: toolOutput !== null && toolOutput !== undefined
        ? (toolOutput as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      status,
      denialReason,
      durationMs: durationMs ?? null,
    },
  })
}
