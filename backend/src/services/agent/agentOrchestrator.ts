/**
 * AgentOrchestrator — the LLM agentic loop for NextStep's AI agent sessions.
 *
 * Responsibilities:
 *  - Selects the correct system prompt per module and trigger.
 *  - Filters tool definitions: SYSTEM sessions never see write-tool definitions
 *    (defense-in-depth on top of AgentExecutionService's runtime enforcement).
 *  - Runs the OpenAI function-calling loop (call → parse → dispatch → repeat)
 *    via the shared createTieredChatCompletion helper in aiClient.ts.
 *  - Handles write-tool confirmation gating for USER sessions:
 *      pauses before any WRITE dispatch, stores a write_intent signal in the
 *      DB, polls for the write_confirmation signal from the confirm endpoint,
 *      resumes when confirmed or exits when denied/timed out.
 *  - Tracks token usage across turns; triggers a final synthesis call if the
 *    running total approaches the model context limit.
 *  - Caps tool calls at session.maxToolCalls (default 12); makes a synthesis
 *    call rather than cutting off silently when the cap is hit.
 *  - Falls back to a deterministic message on any unrecoverable LLM error.
 *  - Calls completeSession() on every exit path (COMPLETED or FAILED).
 *
 * Compliance:
 *  - No student PII (name, email, school name, ID) ever enters a prompt.
 *  - Tool outputs contain only what the tool implementation returns.
 *  - Logs never contain prompt text or student context.
 *  - This service does not participate in model training.
 *
 * Known architecture discrepancy (flagged in handoff):
 *  AgentExecutionService's module-scope check rejects tools whose
 *  registered module ≠ session.module. No tools are registered with
 *  module='CHAT', so CHAT sessions cannot currently dispatch any tool.
 *  The backend must either skip the module check for CHAT sessions or
 *  duplicate tool registrations under module='CHAT'. Until that is resolved,
 *  CHAT sessions will complete without tool calls.
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources/chat/completions'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { logger } from '../../common/logger'
import { createTieredChatCompletion, resolveTierForScore } from '../../lib/aiClient'
import type { ChatTier } from '../../lib/aiClient'
import { dispatchTool, completeSession } from './agentExecution.service'
import type { AgentModule, AgentTrigger } from './agentExecution.service'
import { getToolDefsForSession, WRITE_TOOL_NAMES } from './toolSchemas'
import { buildPlannerSystemPrompt } from './prompts/planner.prompt'
import { buildGpaSystemPrompt } from './prompts/gpa.prompt'
import { buildRoadmapSystemPrompt } from './prompts/roadmap.prompt'
import { buildChatSystemPrompt } from './prompts/chat.prompt'
import { chatIntentRouter } from '../../services/ai/intentRouter'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_OUTPUT_TOKENS = 4096

/**
 * Token threshold at which we stop calling more tools and make a final
 * synthesis call instead. Set conservatively relative to the model's
 * context window (NVIDIA Llama 3.1 70B: 128K; OpenRouter models vary).
 * Leaves a comfortable margin for the synthesis prompt and final response.
 */
const TOKEN_SUMMARY_THRESHOLD = 100_000

/** How often to poll the DB while waiting for write confirmation (ms). */
const CONFIRM_POLL_INTERVAL_MS = 2_000

/** Maximum time to wait for a write confirmation before timing out (ms). */
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1_000 // 5 minutes

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  sessionId: number
  userId: number
  module: AgentModule
  trigger: AgentTrigger
  userMessage: string
  ipAddress: string
}

// ── System prompt selector ────────────────────────────────────────────────────

function buildStaticSystemPrompt(module: AgentModule, trigger: AgentTrigger): string {
  switch (module) {
    case 'PLANNER':
      return buildPlannerSystemPrompt(trigger)
    case 'GPA':
      return buildGpaSystemPrompt(trigger)
    case 'ROADMAP':
      return buildRoadmapSystemPrompt(trigger)
    case 'CHAT':
      return buildChatSystemPrompt(trigger)
  }
}

/**
 * Builds a current date/time context string to inject into the system prompt
 * at request time (not at module load time) so the model always sees the
 * actual date of the session.
 *
 * Timezone: always UTC. No per-user timezone field exists in the schema.
 * If a timezone field is added in a future release, reuse it here rather than
 * defaulting to UTC — see handoff note.
 *
 * Exported for testing (allows clock mocking in unit tests).
 */
export function buildCurrentDateContext(): string {
  const now = new Date()
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  const monthName = now.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  const day = now.getUTCDate()
  const year = now.getUTCFullYear()
  const hours = String(now.getUTCHours()).padStart(2, '0')
  const minutes = String(now.getUTCMinutes()).padStart(2, '0')
  return (
    `Today is ${dayOfWeek}, ${monthName} ${day}, ${year}. ` +
    `The current time is ${hours}:${minutes} UTC. ` +
    `When resolving relative date phrases (e.g. "tomorrow", "next Friday", "in 3 days"), ` +
    `use this date as your reference point.`
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFallback(module: AgentModule): string {
  const messages: Record<AgentModule, string> = {
    PLANNER:
      'I was unable to complete your planner request right now. Please try again in a moment, or manage your tasks directly in the planner.',
    GPA:
      'I was unable to retrieve your GPA information right now. Please check your grades directly or try again in a moment.',
    ROADMAP:
      'I was unable to access your roadmap information right now. Please view your course plan directly or try again in a moment.',
    CHAT:
      'I was unable to process your request right now. Please try again in a moment.',
  }
  return messages[module]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Describe a write action in plain English for the write_intent record. */
function describeWriteAction(toolName: string, toolInput: unknown): string {
  const input = (toolInput ?? {}) as Record<string, unknown>
  switch (toolName) {
    case 'planner_create_task':
      return `Create task: "${String(input.title ?? '?')}" in ${String(input.subject ?? '?')}`
    case 'planner_update_task':
      return `Update task #${String(input.taskId ?? '?')}`
    case 'planner_complete_task':
      return `Mark task #${String(input.taskId ?? '?')} as complete`
    case 'planner_delete_task':
      return `Delete task #${String(input.taskId ?? '?')}`
    case 'roadmap_apply_course_change':
      return `Change ${String(input.field ?? '?')} for course #${String(input.courseId ?? '?')} to "${String(input.newValue ?? '?')}"`
    default:
      return `Execute ${toolName}`
  }
}

/**
 * Prefixes the final response text with a tier tag when the
 * AI_CHAT_DEBUG_TIER_TAG env var is 'true' and a tier is defined.
 * Mirrors the identical behavior in the non-agentic chat route (ai.ts) so
 * debug output is consistent regardless of which code path answered.
 * When tier is undefined (off-topic / default-provider fallback) no tag is
 * applied, matching ai.ts which only tags when `tier` is truthy.
 */
function applyTierDebugTag(text: string, tier: ChatTier | undefined): string {
  return process.env.AI_CHAT_DEBUG_TIER_TAG === 'true' && tier !== undefined
    ? `(${tier.toUpperCase()}) ${text}`
    : text
}

/**
 * Safely parse JSON arguments from a tool call. Returns an empty object on
 * any parse failure so the orchestration loop can continue rather than crash.
 */
function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

// ── Write-tool confirmation flow ──────────────────────────────────────────────

/**
 * For USER-triggered sessions, pause before dispatching a write tool.
 * Creates a write_intent PENDING record (so the client can poll and show the
 * pending action), then polls for either:
 *   - A write_confirmation PENDING record (confirmed=true) → returns true
 *   - Session status ≠ RUNNING (confirmed=false closes the session) → returns false
 *   - Timeout → marks session failed, returns false
 *
 * The write_intent record stays in the DB as an audit trail of what was
 * proposed. The write_confirmation record created by the confirm endpoint is
 * consumed (marked SUCCESS) so a second poll doesn't re-trigger.
 */
async function awaitWriteConfirmation(
  sessionId: number,
  toolName: string,
  toolInput: unknown,
): Promise<boolean> {
  // Create the write_intent PENDING record for the client to display.
  let intentRecordId: number
  try {
    const intentRecord = await prisma.agentToolCall.create({
      data: {
        sessionId,
        toolName: 'write_intent',
        toolInput: {
          pendingToolName: toolName,
          pendingToolInput: toolInput,
          description: describeWriteAction(toolName, toolInput),
        } as Prisma.InputJsonValue,
        toolOutput: Prisma.JsonNull,
        status: 'PENDING',
        denialReason: null,
      },
    })
    intentRecordId = intentRecord.id
  } catch (err) {
    logger.error('agent_write_intent_record_failed', {
      sessionId,
      toolName,
      errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
    })
    // Cannot create intent record — fail safe by denying the write.
    return false
  }

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS

  try {
    while (Date.now() < deadline) {
      await sleep(CONFIRM_POLL_INTERVAL_MS)

      // Check if the session was terminated by the deny path (confirmed=false).
      // The confirm endpoint calls completeSession(..., 'FAILED') on deny,
      // which sets status to 'FAILED'.
      const session = await prisma.agentSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      })

      if (session === null || session.status !== 'RUNNING') {
        // Session terminated — user denied or external error.
        await prisma.agentToolCall.update({
          where: { id: intentRecordId },
          data: { status: 'DENIED', denialReason: 'USER_REJECTED' },
        }).catch(() => {})
        return false
      }

      // Check for the write_confirmation PENDING record created by the
      // confirm endpoint when confirmed=true.
      const confirmation = await prisma.agentToolCall.findFirst({
        where: {
          sessionId,
          toolName: 'write_confirmation',
          status: 'PENDING',
          toolInput: {
            path: ['confirmed'],
            equals: true,
          },
        },
        orderBy: { executedAt: 'desc' },
      })

      if (confirmation !== null) {
        // Consume the confirmation signal and mark the intent as confirmed.
        await Promise.all([
          prisma.agentToolCall.update({
            where: { id: confirmation.id },
            data: { status: 'SUCCESS' },
          }),
          prisma.agentToolCall.update({
            where: { id: intentRecordId },
            data: { status: 'SUCCESS' },
          }),
        ])
        return true
      }
    }

    // Timeout — no confirmation received within 5 minutes.
    logger.warn('agent_write_confirmation_timeout', { sessionId, toolName })
    await prisma.agentToolCall.update({
      where: { id: intentRecordId },
      data: { status: 'FAILED', denialReason: 'ERROR' },
    }).catch(() => {})
    return false

  } catch (err) {
    logger.error('agent_write_confirmation_poll_error', {
      sessionId,
      toolName,
      errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
    })
    await prisma.agentToolCall.update({
      where: { id: intentRecordId },
      data: { status: 'FAILED', denialReason: 'ERROR' },
    }).catch(() => {})
    return false
  }
}

// ── Synthesis call (cap / token limit hit) ────────────────────────────────────

/**
 * Makes a final LLM call without tools, asking for a complete synthesis
 * of everything gathered so far. Used when the tool cap or token threshold
 * is reached.
 *
 * Defensive guard: if a pre-dispatch stop condition (token threshold or tool
 * cap) fires after the model responded with finish_reason='tool_calls' but
 * before those tool calls have been dispatched, conversationMessages ends with
 * an assistant message that has a non-empty tool_calls array but no following
 * tool role messages. The OpenAI-compatible API (OpenRouter, NVIDIA NIM) treats
 * this as a hard contract violation and rejects the request with a 4xx error.
 *
 * To satisfy the contract unconditionally, we strip the tool_calls field from
 * any trailing assistant message before building synthesisMessages. The message's
 * content (if any) is preserved — it may still carry useful context for
 * generating a coherent final answer. Callers do not need to sanitize the array
 * themselves; this function is safe from any call site.
 */
async function makeFinalSynthesisCall(
  conversationMessages: ChatCompletionMessageParam[],
  systemPrompt: string,
  reason: 'cap' | 'token_limit',
  tier: ChatTier | undefined,
): Promise<string> {
  // Strip a dangling tool_calls field from the last assistant message, if
  // present. A dangling tool_calls turn has no following tool messages and
  // is rejected by the API. Keeping the content gives the model context for
  // its synthesis; omitting tool_calls removes the invalid API constraint.
  const sanitizedMessages: ChatCompletionMessageParam[] = (() => {
    if (conversationMessages.length === 0) return conversationMessages
    const last = conversationMessages[conversationMessages.length - 1]
    if (last.role === 'assistant' && Array.isArray(last.tool_calls) && last.tool_calls.length > 0) {
      const sanitizedLast: ChatCompletionMessageParam = {
        role: 'assistant',
        content: typeof last.content === 'string' ? last.content : '',
      }
      return [...conversationMessages.slice(0, -1), sanitizedLast]
    }
    return conversationMessages
  })()

  const synthesisInstruction: ChatCompletionMessageParam = {
    role: 'user',
    content:
      reason === 'cap'
        ? 'You have reached your tool call limit for this session. Based on everything you have gathered so far, please provide your complete final response to the student. Do not call any more tools.'
        : 'You are approaching the session context limit. Based on everything gathered so far, please provide your complete final response to the student now. Do not call any more tools.',
  }

  const synthesisMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...sanitizedMessages,
    synthesisInstruction,
  ]

  try {
    const response = await createTieredChatCompletion(tier, {
      messages: synthesisMessages,
      max_tokens: MAX_OUTPUT_TOKENS,
      // No tools — prevent any further tool calls in the synthesis turn.
    })

    const text = response.choices[0]?.message.content?.trim() ?? ''
    return text.length > 0
      ? text
      : 'I was able to gather information for you but could not complete a full response. Please try again with a more specific question.'

  } catch (synthErr) {
    logger.warn('agent_synthesis_call_failed', {
      errorType: synthErr instanceof Error ? synthErr.constructor.name : 'UnknownError',
    })
    return 'I gathered some information for your request but reached my processing limit before completing the full response. Please try again.'
  }
}

// ── Main orchestration loop ───────────────────────────────────────────────────

/**
 * Runs the full agentic loop for an existing RUNNING session.
 *
 * This function is designed to be called fire-and-forget from the route
 * (void + .catch). It is responsible for calling completeSession() on
 * every exit path — the caller must NOT call completeSession() separately.
 */
export async function runAgentOrchestrator(opts: OrchestratorOptions): Promise<void> {
  const { sessionId, module, trigger, userMessage, ipAddress } = opts

  // Assemble the full system prompt: static module instructions + a freshly
  // computed date/time context injected at request time so the model always
  // knows the real current date. Never hardcode this into the static prompt
  // files — they are module-load-time constants.
  const systemPrompt =
    buildStaticSystemPrompt(module, trigger) +
    '\n\n## Current date and time\n' +
    buildCurrentDateContext()

  const toolDefs = getToolDefsForSession(module, trigger)

  // Load session maxToolCalls (DB default is 12; hard cap is 15 in service).
  let maxToolCalls = 12
  try {
    const sessionRow = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      select: { maxToolCalls: true },
    })
    if (sessionRow !== null) maxToolCalls = sessionRow.maxToolCalls
  } catch {
    // Non-fatal: fall back to the default.
  }

  // Classify the initial user message once to determine the model tier for the
  // entire session. The complexity classifier runs only here — not on every
  // tool-use turn — because it is scoring user intent, not LLM output, and
  // re-classifying each turn would be wasteful and semantically wrong.
  //
  // Fallback behaviour (matches the non-agentic chat route):
  //   - Empty message (e.g. SYSTEM-triggered sessions) → skip classification,
  //     use undefined tier (routes to the default provider via createChatCompletion).
  //   - Classifier failure or null complexityScore (off-topic / blocked) →
  //     resolveTierForScore returns undefined → same default-provider fallback.
  //
  // chatIntentRouter.analyze() never throws; it catches internally and fails open.
  let sessionTier: ChatTier | undefined
  if (userMessage.trim().length > 0) {
    const intentAnalysis = await chatIntentRouter.analyze(userMessage)
    sessionTier = resolveTierForScore(intentAnalysis.complexityScore)
  }

  // Conversation history (excludes the system message — prepended on each call).
  const conversationMessages: ChatCompletionMessageParam[] = [
    { role: 'user', content: userMessage.trim().length > 0 ? userMessage : 'Hello' },
  ]

  let toolCallCount = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let finalText = ''

  try {
    while (true) {
      // ── LLM API call ──────────────────────────────────────────────────────

      let response: Awaited<ReturnType<typeof createTieredChatCompletion>>
      try {
        response = await createTieredChatCompletion(sessionTier, {
          messages: [
            { role: 'system', content: systemPrompt },
            ...conversationMessages,
          ],
          tools: toolDefs,
          max_tokens: MAX_OUTPUT_TOKENS,
        })
      } catch (llmErr) {
        // Never log prompt contents — they contain session context.
        logger.warn('agent_llm_call_failed', {
          sessionId,
          module,
          trigger,
          errorType: llmErr instanceof Error ? llmErr.constructor.name : 'UnknownError',
          toolCallCount,
        })
        const fallback = finalText.length > 0
          ? finalText + '\n\n(I encountered an issue retrieving more information. The above is what I was able to gather.)'
          : buildFallback(module)
        await completeSession(sessionId, fallback, 'FAILED', 'LLM call failed')
        return
      }

      // Track token usage across turns.
      totalInputTokens += response.usage?.prompt_tokens ?? 0
      totalOutputTokens += response.usage?.completion_tokens ?? 0

      const choice = response.choices[0]
      if (choice === undefined) {
        logger.warn('agent_llm_empty_choices', { sessionId, toolCallCount })
        const msg = finalText.length > 0 ? finalText : buildFallback(module)
        await completeSession(sessionId, msg, 'FAILED', 'LLM returned no choices')
        return
      }

      const assistantMessage = choice.message

      // Capture any text content from this turn.
      const turnText = assistantMessage.content?.trim() ?? ''
      if (turnText.length > 0) finalText = turnText

      // Append the assistant message to conversation history.
      // Include tool_calls only when present (TypeScript narrowing requires this).
      const functionToolCalls: ChatCompletionMessageFunctionToolCall[] =
        (assistantMessage.tool_calls ?? []).filter(
          (tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === 'function',
        )
      const assistantEntry: ChatCompletionMessageParam =
        functionToolCalls.length > 0
          ? {
              role: 'assistant',
              content: assistantMessage.content ?? null,
              tool_calls: functionToolCalls,
            }
          : {
              role: 'assistant',
              content: assistantMessage.content ?? '',
            }
      conversationMessages.push(assistantEntry)

      // ── Stop conditions ───────────────────────────────────────────────────

      if (choice.finish_reason === 'stop') {
        // Model is done — no tool calls requested.
        const finalResponse = finalText.length > 0 ? finalText : buildFallback(module)
        await completeSession(sessionId, applyTierDebugTag(finalResponse, sessionTier), 'COMPLETED')
        return
      }

      if (choice.finish_reason !== 'tool_calls') {
        // Unexpected finish reason (e.g., 'length' for max_tokens hit mid-turn).
        logger.warn('agent_unexpected_finish_reason', {
          sessionId,
          finishReason: choice.finish_reason,
          toolCallCount,
        })
        const msg = finalText.length > 0 ? finalText : buildFallback(module)
        await completeSession(sessionId, msg, 'COMPLETED')
        return
      }

      // ── Token limit guard ─────────────────────────────────────────────────

      if (totalInputTokens + totalOutputTokens > TOKEN_SUMMARY_THRESHOLD) {
        logger.info('agent_token_threshold_reached', {
          sessionId,
          totalInputTokens,
          totalOutputTokens,
        })
        const synthesized = await makeFinalSynthesisCall(conversationMessages, systemPrompt, 'token_limit', sessionTier)
        await completeSession(sessionId, applyTierDebugTag(synthesized, sessionTier), 'COMPLETED')
        return
      }

      // ── Tool call cap guard ───────────────────────────────────────────────

      if (toolCallCount >= maxToolCalls) {
        logger.info('agent_tool_cap_reached', { sessionId, toolCallCount, maxToolCalls })
        const synthesized = await makeFinalSynthesisCall(conversationMessages, systemPrompt, 'cap', sessionTier)
        await completeSession(sessionId, applyTierDebugTag(synthesized, sessionTier), 'COMPLETED')
        return
      }

      // ── Extract tool calls ────────────────────────────────────────────────

      // Use the already-filtered function tool calls (computed above for the
      // assistant message entry). Non-function custom tool call types are
      // unsupported and skipped.
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = functionToolCalls

      if (toolCalls.length === 0) {
        // finish_reason was tool_calls but no tool_calls present — malformed response.
        logger.warn('agent_tool_calls_empty', { sessionId, toolCallCount })
        const msg = finalText.length > 0 ? finalText : buildFallback(module)
        await completeSession(sessionId, msg, 'COMPLETED')
        return
      }

      // ── Separate reads and writes ─────────────────────────────────────────

      const readCalls = toolCalls.filter(tc => !WRITE_TOOL_NAMES.has(tc.function.name))
      const writeCalls = toolCalls.filter(tc => WRITE_TOOL_NAMES.has(tc.function.name))

      // Build result map: tool_call_id → result content string.
      const resultMap = new Map<string, string>()

      // Execute read tools in parallel.
      if (readCalls.length > 0) {
        const readResults = await Promise.allSettled(
          readCalls.map(async (tc) => {
            const toolInput = parseToolArguments(tc.function.arguments)
            const result = await dispatchTool(sessionId, tc.function.name, toolInput, ipAddress)
            return { id: tc.id, toolName: tc.function.name, result }
          }),
        )

        for (const settled of readResults) {
          if (settled.status === 'fulfilled') {
            const { id, toolName, result } = settled.value
            toolCallCount++
            if (result.success) {
              resultMap.set(id, JSON.stringify(result.output))
            } else {
              // Malformed or denied — log and continue with an error result.
              logger.warn('agent_read_tool_failed', {
                sessionId,
                toolName,
                denialReason: result.denialReason,
              })
              resultMap.set(
                id,
                JSON.stringify({
                  error: result.denialReason ?? 'FAILED',
                  message: `Tool ${toolName} could not be executed.`,
                }),
              )
            }
          } else {
            // Promise itself rejected (unexpected) — log as FAILED and continue.
            // Note: toolCallCount is intentionally NOT incremented for rejected
            // promises. In the unlikely scenario that every read-tool dispatch in
            // a turn rejects, the pre-dispatch cap check at line 458 would not
            // fire (the cap only counts successfully settled dispatches). The
            // token-threshold check acts as the backstop in that case. This is
            // acceptable bounded behavior and not a security concern per QA.
            logger.warn('agent_read_tool_promise_rejected', {
              sessionId,
              reason: String(settled.reason),
            })
          }
        }
      }

      // Handle write tools (USER: confirm first; SYSTEM: should not appear
      // since tool defs are filtered, but guard defensively).
      for (const tc of writeCalls) {
        if (trigger === 'SYSTEM') {
          // Defense in depth: write tools should never appear for SYSTEM sessions.
          logger.warn('agent_write_tool_in_system_session', {
            sessionId,
            toolName: tc.function.name,
          })
          resultMap.set(
            tc.id,
            JSON.stringify({ error: 'DENIED', message: 'Write tools are not available in this session.' }),
          )
          continue
        }

        // USER trigger: gate on confirmation.
        const toolInput = parseToolArguments(tc.function.arguments)
        const confirmed = await awaitWriteConfirmation(sessionId, tc.function.name, toolInput)

        if (!confirmed) {
          // Session was either terminated by deny path or timed out.
          const sessionRow = await prisma.agentSession.findUnique({
            where: { id: sessionId },
            select: { status: true },
          })
          if (sessionRow?.status !== 'RUNNING') {
            // Session already closed by the route handler (deny path) — exit.
            return
          }
          // Timeout path — session still RUNNING but no confirmation.
          await completeSession(
            sessionId,
            'The write action was not confirmed within the allowed time.',
            'FAILED',
            'WRITE_CONFIRMATION_TIMEOUT',
          )
          return
        }

        // Confirmed — dispatch the write tool.
        const result = await dispatchTool(sessionId, tc.function.name, toolInput, ipAddress)
        toolCallCount++

        if (result.success) {
          resultMap.set(tc.id, JSON.stringify(result.output))
        } else {
          // Write dispatch failed (rate limit, error, etc.).
          logger.warn('agent_write_tool_dispatch_failed', {
            sessionId,
            toolName: tc.function.name,
            denialReason: result.denialReason,
          })
          resultMap.set(
            tc.id,
            JSON.stringify({
              error: result.denialReason ?? 'FAILED',
              message: `The action could not be completed: ${result.denialReason ?? 'unknown error'}.`,
            }),
          )
        }
      }

      // Ensure every tool call has a result (even if we missed one above).
      for (const tc of toolCalls) {
        if (!resultMap.has(tc.id)) {
          logger.warn('agent_tool_call_missing_result', {
            sessionId,
            toolName: tc.function.name,
            toolCallId: tc.id,
          })
          resultMap.set(
            tc.id,
            JSON.stringify({ error: 'FAILED', message: `No result recorded for tool ${tc.function.name}.` }),
          )
        }
      }

      // Append one tool message per call result (OpenAI multi-turn format).
      for (const tc of toolCalls) {
        const toolResultMessage: ChatCompletionMessageParam = {
          role: 'tool',
          tool_call_id: tc.id,
          content: resultMap.get(tc.id) ?? JSON.stringify({ error: 'FAILED' }),
        }
        conversationMessages.push(toolResultMessage)
      }

      // Re-check cap after executing (some tools may have incremented count).
      if (toolCallCount >= maxToolCalls) {
        logger.info('agent_tool_cap_reached_post_dispatch', {
          sessionId,
          toolCallCount,
          maxToolCalls,
        })
        const synthesized = await makeFinalSynthesisCall(conversationMessages, systemPrompt, 'cap', sessionTier)
        await completeSession(sessionId, applyTierDebugTag(synthesized, sessionTier), 'COMPLETED')
        return
      }

      // Continue the loop — the model will process the tool results.
    }
  } catch (unexpectedErr) {
    // Catch-all for any unhandled error in the orchestration loop.
    logger.error('agent_orchestrator_unhandled_error', {
      sessionId,
      module,
      trigger,
      errorType: unexpectedErr instanceof Error ? unexpectedErr.constructor.name : 'UnknownError',
    })
    const errorMsg = unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr)
    await completeSession(
      sessionId,
      finalText.length > 0 ? finalText : buildFallback(module),
      'FAILED',
      `Orchestrator error: ${errorMsg}`,
    ).catch(() => {})
  }
}
