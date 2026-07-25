/**
 * Integration tests for AgentOrchestrator — LLM tool-use loop (OpenAI format).
 *
 * Written by qa-engineer to cover the orchestrator-level loop logic that was
 * refactored from Anthropic SDK format to OpenAI function-calling format.
 * This is the coverage gap explicitly flagged by ai-engineer in the handoff:
 * no prior orchestrator-level tests existed.
 *
 * Coverage:
 *  1. Multi-turn tool-use loop: message history pairing (assistant+tool messages)
 *     across multiple rounds, including parallel tool calls in one response.
 *  2. Write-confirmation pause/resume: intent record created, poll cycles run,
 *     dispatch happens only after confirmation, tool message appended correctly.
 *  3. SYSTEM-session write-tool exclusion: the `tools` array passed to the LLM
 *     for SYSTEM-triggered sessions must never contain a write tool.
 *
 * Mocked: createTieredChatCompletion (aiClient), dispatchTool + completeSession
 * (agentExecution.service), prisma (for orchestrator's direct DB calls).
 *
 * NOT mocked: toolSchemas.ts — the real getToolDefsForSession filter logic is
 * exercised in suite 3 to verify t.function.name is used correctly.
 */

import { runAgentOrchestrator, buildCurrentDateContext } from '../agentOrchestrator'
import type { OrchestratorOptions } from '../agentOrchestrator'

// ── Mock: AI client ───────────────────────────────────────────────────────────
//
// Must be mocked before anything imports aiClient. jest.mock is hoisted.

const mockCreateTieredChatCompletion = jest.fn()
const mockResolveTierForScore = jest.fn()

jest.mock('../../../lib/aiClient', () => ({
  createTieredChatCompletion: (...args: unknown[]) =>
    mockCreateTieredChatCompletion(...args),
  resolveTierForScore: (...args: unknown[]) =>
    mockResolveTierForScore(...args),
}))

// ── Mock: Intent router (complexity classifier) ────────────────────────────────

const mockAnalyze = jest.fn()

jest.mock('../../../services/ai/intentRouter', () => ({
  chatIntentRouter: {
    analyze: (...args: unknown[]) => mockAnalyze(...args),
  },
}))

// ── Mock: Prisma (orchestrator direct DB calls: session lookup + write-confirm) ─

const mockSessionFindUnique = jest.fn()
const mockToolCallCreate = jest.fn()
const mockToolCallFindFirst = jest.fn()
const mockToolCallUpdate = jest.fn()

jest.mock('../../../lib/prisma', () => ({
  prisma: {
    agentSession: {
      findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
    },
    agentToolCall: {
      create: (...args: unknown[]) => mockToolCallCreate(...args),
      findFirst: (...args: unknown[]) => mockToolCallFindFirst(...args),
      update: (...args: unknown[]) => mockToolCallUpdate(...args),
    },
  },
}))

// ── Mock: AgentExecution service ───────────────────────────────────────────────
//
// The security-critical enforcement (COPPA, allowlist, rate-limit, audit-log)
// lives here and is already covered by agentSecurity.qa.test.ts. We mock it
// here so the orchestrator-level tests can run without a live database.

const mockDispatchTool = jest.fn()
const mockCompleteSession = jest.fn()

jest.mock('../agentExecution.service', () => ({
  dispatchTool: (...args: unknown[]) => mockDispatchTool(...args),
  completeSession: (...args: unknown[]) => mockCompleteSession(...args),
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

type FunctionToolCall = {
  type: 'function'
  id: string
  function: { name: string; arguments: string }
}

interface LlmResponseOpts {
  finishReason: 'stop' | 'tool_calls' | 'length'
  content?: string
  toolCalls?: Array<{ id: string; name: string; args: string }>
  promptTokens?: number
  completionTokens?: number
}

function makeLlmResponse(opts: LlmResponseOpts) {
  const toolCalls: FunctionToolCall[] | undefined =
    opts.toolCalls && opts.toolCalls.length > 0
      ? opts.toolCalls.map(tc => ({
          type: 'function' as const,
          id: tc.id,
          function: { name: tc.name, arguments: tc.args },
        }))
      : undefined

  return {
    choices: [
      {
        finish_reason: opts.finishReason,
        message: {
          role: 'assistant',
          content: opts.content ?? null,
          tool_calls: toolCalls,
        },
      },
    ],
    usage: {
      prompt_tokens: opts.promptTokens ?? 100,
      completion_tokens: opts.completionTokens ?? 50,
    },
  }
}

const BASE_OPTS: OrchestratorOptions = {
  sessionId: 1,
  userId: 42,
  module: 'PLANNER',
  trigger: 'USER',
  userMessage: 'What tasks do I have?',
  ipAddress: '127.0.0.1',
}

// ── Shared setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  // Default: session has maxToolCalls = 12.
  mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 12, status: 'RUNNING' })
  // Default: dispatchTool always succeeds.
  mockDispatchTool.mockResolvedValue({ success: true, output: { result: 'ok' } })
  // Default: completeSession is a no-op.
  mockCompleteSession.mockResolvedValue(undefined)
  // Default: agentToolCall DB operations succeed.
  mockToolCallCreate.mockResolvedValue({ id: 99 })
  mockToolCallUpdate.mockResolvedValue({})
  // Default: classifier returns advanced-tier score so existing tests are
  // unaffected (behaviour is identical to the previous hardcoded 'advanced').
  mockAnalyze.mockResolvedValue({
    allowed: true,
    intent: 'surface',
    complexityScore: 75,
    category: 'college_admissions',
  })
  mockResolveTierForScore.mockReturnValue('advanced')
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Multi-turn tool-use loop
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentOrchestrator — multi-turn tool-use loop', () => {
  it('runs a 2-round loop: two parallel tools then stop, with correct message pairing', async () => {
    // Turn 1: model requests two read tools in parallel.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'tc1', name: 'planner_get_tasks', args: '{}' },
          { id: 'tc2', name: 'planner_get_upcoming_deadlines', args: '{"daysAhead":7}' },
        ],
      })
    )
    // Turn 2: model is done.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'You have 3 tasks due this week.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    // LLM called exactly twice.
    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(2)

    // Both tools dispatched (parallel reads).
    expect(mockDispatchTool).toHaveBeenCalledTimes(2)
    expect(mockDispatchTool).toHaveBeenCalledWith(1, 'planner_get_tasks', {}, '127.0.0.1')
    expect(mockDispatchTool).toHaveBeenCalledWith(
      1,
      'planner_get_upcoming_deadlines',
      { daysAhead: 7 },
      '127.0.0.1'
    )

    // The second LLM call must include an assistant message with tool_calls
    // AND one tool message per call — this is the OpenAI API contract.
    type Msg = { role: string; tool_call_id?: string; tool_calls?: FunctionToolCall[] }
    const secondCallMessages = mockCreateTieredChatCompletion.mock.calls[1][1]
      .messages as Msg[]

    const assistantMsg = secondCallMessages.find(
      m => m.role === 'assistant' && Array.isArray(m.tool_calls)
    )
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg!.tool_calls).toHaveLength(2)

    const toolMsgs = secondCallMessages.filter(m => m.role === 'tool')
    expect(toolMsgs).toHaveLength(2)
    expect(toolMsgs.map(m => m.tool_call_id)).toEqual(
      expect.arrayContaining(['tc1', 'tc2'])
    )

    // Session completed with the final model text.
    expect(mockCompleteSession).toHaveBeenCalledWith(
      1,
      'You have 3 tasks due this week.',
      'COMPLETED'
    )
  })

  it('runs a 3-round loop: accumulates assistant+tool message pairs across turns', async () => {
    // Turn 1: one tool.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
      })
    )
    // Turn 2: another tool.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'tc2', name: 'planner_get_upcoming_deadlines', args: '{}' },
        ],
      })
    )
    // Turn 3: final answer.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Here is your summary.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(3)
    expect(mockDispatchTool).toHaveBeenCalledTimes(2)

    // The third LLM call must have BOTH rounds of assistant+tool pairs.
    type Msg = { role: string; tool_call_id?: string }
    const thirdCallMessages = mockCreateTieredChatCompletion.mock.calls[2][1]
      .messages as Msg[]
    const toolMsgs = thirdCallMessages.filter(m => m.role === 'tool')
    expect(toolMsgs).toHaveLength(2)
    expect(toolMsgs.map(m => m.tool_call_id)).toEqual(
      expect.arrayContaining(['tc1', 'tc2'])
    )

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Here is your summary.', 'COMPLETED')
  })

  it('carries forward finalText from earlier turn when stop arrives with empty content', async () => {
    // Turn 1: tool call with visible text.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        content: 'Looking up your tasks now...',
        toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
      })
    )
    // Turn 2: stop with no content.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: '' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    // The text from turn 1 must be used because turn 2 had no content.
    expect(mockCompleteSession).toHaveBeenCalledWith(
      1,
      'Looking up your tasks now...',
      'COMPLETED'
    )
  })

  it('exits after one call on finish_reason=length — no spin', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'length', content: 'Truncated.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    // Called only once; no tool dispatch.
    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(1)
    expect(mockDispatchTool).not.toHaveBeenCalled()
    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Truncated.', 'COMPLETED')
  })

  it('exits cleanly on finish_reason=tool_calls with an empty tool_calls array (malformed response)', async () => {
    // finish_reason says tool_calls but the model returned no tool calls.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'tool_calls', toolCalls: [] })
    )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockDispatchTool).not.toHaveBeenCalled()
    expect(mockCompleteSession).toHaveBeenCalledTimes(1)
  })

  it('always sends system prompt as the first message in the messages array', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    type Msg = { role: string; content?: string }
    const messages = mockCreateTieredChatCompletion.mock.calls[0][1]
      .messages as Msg[]
    expect(messages[0].role).toBe('system')
    // System prompt content is a non-empty string (from buildPlannerSystemPrompt).
    expect(typeof messages[0].content).toBe('string')
    expect((messages[0].content ?? '').length).toBeGreaterThan(0)
    expect(messages[1].role).toBe('user')
  })

  it('token usage is read from usage.prompt_tokens and usage.completion_tokens', async () => {
    // Return high token counts to trigger the token-threshold synthesis path.
    // TOKEN_SUMMARY_THRESHOLD is 100_000; each call accumulates toward it.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        promptTokens: 60_000,
        completionTokens: 45_000, // 60K + 45K = 105K > 100K threshold
      })
    )
    // Synthesis call: stop with text.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Synthesis response.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    // Synthesis path fires — second call has no 'tools' parameter.
    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(2)
    const secondCallParams = mockCreateTieredChatCompletion.mock.calls[1][1] as {
      tools?: unknown
    }
    expect(secondCallParams.tools).toBeUndefined()

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Synthesis response.', 'COMPLETED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Write-confirmation pause/resume
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentOrchestrator — write-confirmation pause/resume', () => {
  // Write confirmation uses a 2-second poll sleep. We use fake timers to
  // advance through poll cycles without real wall-clock waits.

  afterEach(() => {
    jest.useRealTimers()
  })

  it('pauses before dispatching a write tool, resumes on confirmation, appends tool message', async () => {
    jest.useFakeTimers()

    // Turn 1: model requests a write tool.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'wc1',
            name: 'planner_create_task',
            args: JSON.stringify({
              title: 'Math HW',
              subject: 'Math',
              dueDate: '2026-07-20T00:00:00Z',
            }),
          },
        ],
      })
    )
    // Turn 2: model gives final answer after write dispatch.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Task created successfully.' })
    )

    // Intent record created with id=99.
    mockToolCallCreate.mockResolvedValue({ id: 99 })

    // Session findUnique call order:
    //  1. Orchestrator start: maxToolCalls lookup
    //  2. Poll 1 inside awaitWriteConfirmation: session status check (still RUNNING)
    //  3. Poll 2 inside awaitWriteConfirmation: session status check (still RUNNING)
    mockSessionFindUnique
      .mockResolvedValueOnce({ maxToolCalls: 12 })
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValueOnce({ status: 'RUNNING' })

    // findFirst call order (write_confirmation poll):
    //  1. Poll 1: no confirmation yet
    //  2. Poll 2: confirmation record present
    mockToolCallFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 100 })

    mockToolCallUpdate.mockResolvedValue({})

    // Fire the orchestrator (it will pause inside awaitWriteConfirmation).
    const runPromise = runAgentOrchestrator(BASE_OPTS)

    // Advance through poll cycle 1 (sleep = 2 000 ms).
    await jest.advanceTimersByTimeAsync(2001)
    // Advance through poll cycle 2 — confirmation is found this time.
    await jest.advanceTimersByTimeAsync(2001)

    await runPromise

    // Write tool must have been dispatched after confirmation.
    expect(mockDispatchTool).toHaveBeenCalledWith(
      1,
      'planner_create_task',
      { title: 'Math HW', subject: 'Math', dueDate: '2026-07-20T00:00:00Z' },
      '127.0.0.1'
    )

    // Session completed with the final model text.
    expect(mockCompleteSession).toHaveBeenCalledWith(
      1,
      'Task created successfully.',
      'COMPLETED'
    )

    // The second LLM call must include a tool message for wc1 (the write result
    // must be in the history so the model can reference it).
    type Msg = { role: string; tool_call_id?: string }
    const secondCallMessages = mockCreateTieredChatCompletion.mock.calls[1][1]
      .messages as Msg[]
    const writeToolMsg = secondCallMessages.find(
      m => m.role === 'tool' && m.tool_call_id === 'wc1'
    )
    expect(writeToolMsg).toBeDefined()
  })

  it('exits without dispatching or completing session when write confirmation is denied (session closed)', async () => {
    jest.useFakeTimers()

    // Turn 1: write tool requested.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'wc1',
            name: 'planner_create_task',
            args: '{"title":"Test","subject":"Math","dueDate":"2026-07-20T00:00:00Z"}',
          },
        ],
      })
    )

    mockToolCallCreate.mockResolvedValue({ id: 99 })

    // Session findUnique call order:
    //  1. Orchestrator start: maxToolCalls lookup
    //  2. Poll 1: session status is FAILED (user denied via confirm endpoint)
    //  3. Post-denial check in orchestrator body: still FAILED → exit cleanly
    mockSessionFindUnique
      .mockResolvedValueOnce({ maxToolCalls: 12 })
      .mockResolvedValueOnce({ status: 'FAILED' })
      .mockResolvedValueOnce({ status: 'FAILED' })

    mockToolCallUpdate.mockResolvedValue({})

    const runPromise = runAgentOrchestrator(BASE_OPTS)
    await jest.advanceTimersByTimeAsync(2001)
    await runPromise

    // Write tool must NOT be dispatched after denial.
    expect(mockDispatchTool).not.toHaveBeenCalled()
    // Orchestrator exits without calling completeSession (session already closed
    // by the deny route handler).
    expect(mockCompleteSession).not.toHaveBeenCalled()
  })

  it('SYSTEM sessions block write tools defensively even if LLM somehow requests one', async () => {
    // Defense-in-depth: write tools should not appear in the tools array for
    // SYSTEM sessions (verified in suite 3), so the model should never request
    // them. If it somehow does anyway, the orchestrator blocks dispatch.

    // Simulate a SYSTEM session receiving a write tool call from the model.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'wc1', name: 'planner_create_task', args: '{"title":"X","subject":"Y","dueDate":"2026-07-20T00:00:00Z"}' },
        ],
      })
    )
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator({ ...BASE_OPTS, trigger: 'SYSTEM' })

    // Write tool must NOT be dispatched.
    expect(mockDispatchTool).not.toHaveBeenCalled()
    // Session completes normally (with the error result in context).
    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Done.', 'COMPLETED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2b: Synthesis-call conversation-history sanitization
//
// Regression tests for the bug where makeFinalSynthesisCall was called with a
// trailing assistant message containing tool_calls but no following tool
// messages, causing the OpenAI-compatible API to reject the request (4xx) and
// the catch block to silently fall back to a hardcoded canned string.
//
// Reference path that is CORRECT (post-dispatch cap, line ~618): by the time
// that check runs, tool messages have already been appended, so no sanitization
// is needed. The pre-dispatch paths (token threshold ~line 451, cap ~line 461)
// are the broken paths fixed here.
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentOrchestrator — synthesis-call conversation-history sanitization', () => {
  it('token-threshold path: synthesis call receives no trailing assistant message with tool_calls', async () => {
    // Turn 1: model responds with finish_reason='tool_calls' AND token counts
    // that immediately exceed TOKEN_SUMMARY_THRESHOLD (100 000). This causes the
    // pre-dispatch token-threshold check to fire before tool calls are dispatched
    // or their tool messages appended.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        content: 'Let me look up your tasks.',
        toolCalls: [
          { id: 'tc1', name: 'planner_get_tasks', args: '{}' },
          { id: 'tc2', name: 'planner_get_upcoming_deadlines', args: '{"daysAhead":7}' },
        ],
        promptTokens: 70_000,
        completionTokens: 40_000, // 70K + 40K = 110K > 100K threshold
      })
    )
    // Turn 2 (synthesis call): returns a proper final answer.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Here is a synthesis of what I found.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    // Tool dispatch must NOT have been called — the threshold fired pre-dispatch.
    expect(mockDispatchTool).not.toHaveBeenCalled()

    // The synthesis call must have been made (second call to createTieredChatCompletion).
    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(2)

    // Inspect the messages array passed to the synthesis call.
    type Msg = {
      role: string
      content?: string | null
      tool_calls?: FunctionToolCall[]
      tool_call_id?: string
    }
    const synthesisCallMessages = mockCreateTieredChatCompletion.mock.calls[1][1]
      .messages as Msg[]

    // Core assertion: no message in the synthesis call's history may be an
    // assistant message with a non-empty tool_calls array unless it is
    // immediately followed by a tool message for each call. In the pre-dispatch
    // path, no tool messages exist yet, so the sanitizer must have removed
    // tool_calls from the trailing assistant message.
    for (let i = 0; i < synthesisCallMessages.length; i++) {
      const msg = synthesisCallMessages[i]
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        // Every tool_calls entry must have a matching tool message immediately after.
        const toolCallIds = new Set(msg.tool_calls.map(tc => tc.id))
        const followingToolIds = new Set<string>()
        for (let j = i + 1; j < synthesisCallMessages.length; j++) {
          const next = synthesisCallMessages[j]
          if (next.role !== 'tool') break
          if (next.tool_call_id !== undefined) followingToolIds.add(next.tool_call_id)
        }
        for (const id of toolCallIds) {
          expect(followingToolIds.has(id)).toBe(true)
        }
      }
    }

    // Additionally confirm the original content is preserved in the sanitized
    // assistant message (the model text from the tool_calls turn).
    const assistantMsgs = synthesisCallMessages.filter(m => m.role === 'assistant')
    const hasContentPreserved = assistantMsgs.some(
      m => typeof m.content === 'string' && m.content.includes('Let me look up your tasks.')
    )
    expect(hasContentPreserved).toBe(true)

    // Session must complete with the synthesis text, not the fallback canned string.
    expect(mockCompleteSession).toHaveBeenCalledWith(
      1,
      'Here is a synthesis of what I found.',
      'COMPLETED'
    )
    expect(mockCompleteSession).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('I gathered some information for your request but reached my processing limit'),
      expect.anything()
    )
  })

  it('tool-cap path (pre-dispatch): synthesis call receives no trailing assistant message with tool_calls', async () => {
    // Configure maxToolCalls to 0 so the pre-dispatch cap fires immediately on
    // the first turn that returns tool_calls.
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 0, status: 'RUNNING' })

    // Turn 1: model responds with tool_calls — cap check fires before dispatch.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        content: 'I will check your schedule.',
        toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        promptTokens: 500,
        completionTokens: 200,
      })
    )
    // Turn 2 (synthesis call): final answer.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Cap-path synthesis answer.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    // Dispatch must not have been called — cap fired pre-dispatch.
    expect(mockDispatchTool).not.toHaveBeenCalled()
    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(2)

    // Synthesis call messages must not contain a dangling assistant+tool_calls turn.
    type Msg = {
      role: string
      content?: string | null
      tool_calls?: FunctionToolCall[]
      tool_call_id?: string
    }
    const synthesisCallMessages = mockCreateTieredChatCompletion.mock.calls[1][1]
      .messages as Msg[]

    for (let i = 0; i < synthesisCallMessages.length; i++) {
      const msg = synthesisCallMessages[i]
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const toolCallIds = new Set(msg.tool_calls.map(tc => tc.id))
        const followingToolIds = new Set<string>()
        for (let j = i + 1; j < synthesisCallMessages.length; j++) {
          const next = synthesisCallMessages[j]
          if (next.role !== 'tool') break
          if (next.tool_call_id !== undefined) followingToolIds.add(next.tool_call_id)
        }
        for (const id of toolCallIds) {
          expect(followingToolIds.has(id)).toBe(true)
        }
      }
    }

    // Content of the tool_calls turn must be preserved in the sanitized message.
    const assistantMsgs = synthesisCallMessages.filter(m => m.role === 'assistant')
    const hasContentPreserved = assistantMsgs.some(
      m => typeof m.content === 'string' && m.content.includes('I will check your schedule.')
    )
    expect(hasContentPreserved).toBe(true)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Cap-path synthesis answer.', 'COMPLETED')
    expect(mockCompleteSession).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('I gathered some information for your request but reached my processing limit'),
      expect.anything()
    )
  })

  it('post-dispatch cap path: synthesis call already has correct tool messages (no stripping needed)', async () => {
    // With maxToolCalls=1, the pre-dispatch cap does NOT fire (toolCallCount starts
    // at 0, so 0 >= 1 is false), but after one tool dispatch toolCallCount=1 and
    // the post-dispatch cap check (~line 618) fires. At that point, tool messages
    // ARE already in the history — the guard must not strip them.
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 1, status: 'RUNNING' })

    // Turn 1: model returns one tool call.
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({
        finishReason: 'tool_calls',
        content: null,
        toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        promptTokens: 200,
        completionTokens: 100,
      })
    )
    // Turn 2 (synthesis call from post-dispatch cap).
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Post-dispatch cap synthesis.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    // Tool must have been dispatched (post-dispatch path).
    expect(mockDispatchTool).toHaveBeenCalledTimes(1)

    // Synthesis call must include both the assistant message (with tool_calls)
    // AND the tool message — history is already valid, guard must not strip it.
    type Msg = {
      role: string
      content?: string | null
      tool_calls?: FunctionToolCall[]
      tool_call_id?: string
    }
    const synthesisCallMessages = mockCreateTieredChatCompletion.mock.calls[1][1]
      .messages as Msg[]

    const assistantWithToolCalls = synthesisCallMessages.find(
      m => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
    )
    const toolMsg = synthesisCallMessages.find(m => m.role === 'tool' && m.tool_call_id === 'tc1')

    // Both must be present — the guard must not strip a valid paired history.
    expect(assistantWithToolCalls).toBeDefined()
    expect(toolMsg).toBeDefined()

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Post-dispatch cap synthesis.', 'COMPLETED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: SYSTEM-session write-tool exclusion
//
// Tests the real getToolDefsForSession filter (toolSchemas.ts is NOT mocked).
// The critical check: the filter uses t.function.name (correct for the OpenAI
// ChatCompletionFunctionTool type), not t.name (which does not exist on that type).
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentOrchestrator — SYSTEM-session write-tool exclusion', () => {
  it('passes no write tools to the LLM for a SYSTEM PLANNER session', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Planner summary.' })
    )

    await runAgentOrchestrator({ ...BASE_OPTS, trigger: 'SYSTEM' })

    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(1)

    type ToolDef = { type: string; function: { name: string } }
    const toolsArg = mockCreateTieredChatCompletion.mock.calls[0][1].tools as ToolDef[]
    expect(Array.isArray(toolsArg)).toBe(true)

    const PLANNER_WRITE_TOOLS = [
      'planner_create_task',
      'planner_update_task',
      'planner_complete_task',
      'planner_delete_task',
    ]

    // No write tools must appear in the array (the critical assertion).
    for (const writeName of PLANNER_WRITE_TOOLS) {
      const found = toolsArg.some(t => t.function.name === writeName)
      expect(found).toBe(false)
    }

    // Read tools must still be present.
    const toolNames = toolsArg.map(t => t.function.name)
    expect(toolNames).toContain('planner_get_tasks')
    expect(toolNames).toContain('planner_get_upcoming_deadlines')
  })

  it('passes no write tools to the LLM for a SYSTEM ROADMAP session', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Roadmap summary.' })
    )

    await runAgentOrchestrator({ ...BASE_OPTS, module: 'ROADMAP', trigger: 'SYSTEM' })

    type ToolDef = { type: string; function: { name: string } }
    const toolsArg = mockCreateTieredChatCompletion.mock.calls[0][1].tools as ToolDef[]
    const toolNames = toolsArg.map(t => t.function.name)

    // roadmap_apply_course_change is the only roadmap write tool.
    expect(toolNames).not.toContain('roadmap_apply_course_change')

    // Roadmap read tools must still be present.
    expect(toolNames).toContain('roadmap_get_current_plan')
    expect(toolNames).toContain('roadmap_suggest_courses')
    expect(toolNames).toContain('roadmap_get_graduation_requirements')
    expect(toolNames).toContain('roadmap_get_college_readiness')
  })

  it('USER-triggered session DOES include write tools in the tools array (positive control — no tier change)', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator({ ...BASE_OPTS, trigger: 'USER' })

    type ToolDef = { type: string; function: { name: string } }
    const toolsArg = mockCreateTieredChatCompletion.mock.calls[0][1].tools as ToolDef[]
    const toolNames = toolsArg.map(t => t.function.name)

    // USER sessions must see planner write tools.
    expect(toolNames).toContain('planner_create_task')
    expect(toolNames).toContain('planner_update_task')
    expect(toolNames).toContain('planner_complete_task')
    expect(toolNames).toContain('planner_delete_task')
  })

  it('every tool in the tools array has type=function (correct OpenAI format shape)', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    type ToolDef = { type: string; function: { name: string } }
    const toolsArg = mockCreateTieredChatCompletion.mock.calls[0][1].tools as ToolDef[]

    for (const t of toolsArg) {
      expect(t.type).toBe('function')
      expect(typeof t.function.name).toBe('string')
      expect(t.function.name.length).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: Tier classification — one call per session, consistent tier usage
//
// Feature: agent mode must run the initial userMessage through the complexity
// classifier exactly once and use the resolved tier for ALL createTieredChatCompletion
// calls in the session (main loop turns + final synthesis call). Previously the
// orchestrator hardcoded 'advanced' unconditionally.
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentOrchestrator — tier classification (Feature 2)', () => {
  it('classifies the userMessage exactly once at session start, not per tool-use turn', async () => {
    // Two-turn loop: one tool call, then stop.
    mockCreateTieredChatCompletion
      .mockResolvedValueOnce(
        makeLlmResponse({
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        }),
      )
      .mockResolvedValueOnce(
        makeLlmResponse({ finishReason: 'stop', content: 'Here are your tasks.' }),
      )

    await runAgentOrchestrator(BASE_OPTS)

    // Classifier must be invoked exactly ONCE regardless of how many LLM turns run.
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    expect(mockAnalyze).toHaveBeenCalledWith(BASE_OPTS.userMessage)
  })

  it('passes the resolved tier to every createTieredChatCompletion call including synthesis', async () => {
    // Configure the classifier to return a basic-tier score for this test.
    mockAnalyze.mockResolvedValueOnce({
      allowed: true,
      intent: 'surface',
      complexityScore: 20,
      category: 'basic_academics',
    })
    mockResolveTierForScore.mockReturnValueOnce('basic')

    // Single-turn session that hits the tool cap immediately (maxToolCalls=0),
    // forcing a synthesis call — so we get two createTieredChatCompletion calls
    // and can verify both receive the same tier.
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 0, status: 'RUNNING' })

    mockCreateTieredChatCompletion
      .mockResolvedValueOnce(
        makeLlmResponse({
          finishReason: 'tool_calls',
          content: 'Checking tasks.',
          toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        }),
      )
      .mockResolvedValueOnce(
        makeLlmResponse({ finishReason: 'stop', content: 'Synthesis done.' }),
      )

    await runAgentOrchestrator(BASE_OPTS)

    // Both the main-loop call and the synthesis call must use 'basic', not 'advanced'.
    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(2)
    for (const call of mockCreateTieredChatCompletion.mock.calls) {
      expect(call[0]).toBe('basic')
    }

    // resolveTierForScore must have been called with the classifier's score.
    expect(mockResolveTierForScore).toHaveBeenCalledWith(20)
  })

  it('uses undefined tier (default provider routing) when classifier returns null score', async () => {
    // Classifier fails open: complexityScore null means off-topic / blocked.
    // resolveTierForScore(null) → undefined → createChatCompletion fallback.
    mockAnalyze.mockResolvedValueOnce({
      allowed: false,
      intent: 'surface',
      complexityScore: null,
      category: 'off_topic',
    })
    mockResolveTierForScore.mockReturnValueOnce(undefined)

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Response.' }),
    )

    await runAgentOrchestrator(BASE_OPTS)

    // The LLM call must receive undefined as the tier (matches non-agentic chat fallback).
    expect(mockCreateTieredChatCompletion.mock.calls[0][0]).toBeUndefined()
  })

  it('skips classification and uses undefined tier for an empty userMessage (SYSTEM sessions)', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'System response.' }),
    )

    await runAgentOrchestrator({ ...BASE_OPTS, userMessage: '', trigger: 'SYSTEM' })

    // Classifier must NOT be called for an empty message.
    expect(mockAnalyze).not.toHaveBeenCalled()

    // Tier passed to LLM must be undefined (default provider).
    expect(mockCreateTieredChatCompletion.mock.calls[0][0]).toBeUndefined()
  })

  it('advanced tier returned by classifier is used for all calls in the session', async () => {
    // Verify the happy path: 75-score → 'advanced' tier → all LLM calls use 'advanced'.
    // (The default beforeEach already sets this up, but we make it explicit here
    // so this test documents the expected end-to-end flow.)
    mockAnalyze.mockResolvedValueOnce({
      allowed: true,
      intent: 'personalized',
      complexityScore: 75,
      category: 'advanced_planning',
    })
    mockResolveTierForScore.mockReturnValueOnce('advanced')

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Advanced response.' }),
    )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCreateTieredChatCompletion).toHaveBeenCalledTimes(1)
    expect(mockCreateTieredChatCompletion.mock.calls[0][0]).toBe('advanced')
    expect(mockResolveTierForScore).toHaveBeenCalledWith(75)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Debug tier tag on final response (AI_CHAT_DEBUG_TIER_TAG)
//
// Verifies that the orchestrator applies the same (TIER) prefix as the
// non-agentic chat route (ai.ts) when AI_CHAT_DEBUG_TIER_TAG='true'.
//
// Coverage per task brief:
//  (a) env=true + tier='basic' or 'advanced' → both the normal-stop path and
//      every synthesis-call path (token limit, pre-dispatch cap, post-dispatch
//      cap) prefix the response with (BASIC) or (ADVANCED).
//  (b) env unset / env='false' → no tag applied regardless of tier.
//  (c) sessionTier=undefined → no tag even when env='true'.
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentOrchestrator — debug tier tag on final response (AI_CHAT_DEBUG_TIER_TAG)', () => {
  const savedEnv = process.env.AI_CHAT_DEBUG_TIER_TAG

  afterEach(() => {
    // Restore env var after each test so suites don't bleed into each other.
    if (savedEnv === undefined) {
      delete process.env.AI_CHAT_DEBUG_TIER_TAG
    } else {
      process.env.AI_CHAT_DEBUG_TIER_TAG = savedEnv
    }
  })

  // ── (a) normal-stop path ──────────────────────────────────────────────────

  it('(a) normal-stop: prefixes with (BASIC) when env=true and tier=basic', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'true'
    mockAnalyze.mockResolvedValueOnce({ allowed: true, intent: 'surface', complexityScore: 20, category: 'basic' })
    mockResolveTierForScore.mockReturnValueOnce('basic')

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'You have two tasks.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, '(BASIC) You have two tasks.', 'COMPLETED')
  })

  it('(a) normal-stop: prefixes with (ADVANCED) when env=true and tier=advanced', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'true'
    // Default beforeEach already returns 'advanced' — make it explicit here.
    mockAnalyze.mockResolvedValueOnce({ allowed: true, intent: 'personalized', complexityScore: 75, category: 'advanced' })
    mockResolveTierForScore.mockReturnValueOnce('advanced')

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Advanced answer.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, '(ADVANCED) Advanced answer.', 'COMPLETED')
  })

  // ── (a) synthesis-call path — pre-dispatch tool cap ───────────────────────

  it('(a) synthesis (pre-dispatch cap): prefixes with (ADVANCED) when env=true', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'true'
    // maxToolCalls=0 so the pre-dispatch cap fires on the first tool_calls turn.
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 0, status: 'RUNNING' })
    // Default beforeEach resolves 'advanced'.

    mockCreateTieredChatCompletion
      .mockResolvedValueOnce(
        makeLlmResponse({
          finishReason: 'tool_calls',
          content: 'Let me check.',
          toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        })
      )
      .mockResolvedValueOnce(
        makeLlmResponse({ finishReason: 'stop', content: 'Cap synthesis answer.' })
      )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, '(ADVANCED) Cap synthesis answer.', 'COMPLETED')
  })

  it('(a) synthesis (pre-dispatch cap): prefixes with (BASIC) when env=true and tier=basic', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'true'
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 0, status: 'RUNNING' })
    mockAnalyze.mockResolvedValueOnce({ allowed: true, intent: 'surface', complexityScore: 20, category: 'basic' })
    mockResolveTierForScore.mockReturnValueOnce('basic')

    mockCreateTieredChatCompletion
      .mockResolvedValueOnce(
        makeLlmResponse({
          finishReason: 'tool_calls',
          content: 'Checking.',
          toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        })
      )
      .mockResolvedValueOnce(
        makeLlmResponse({ finishReason: 'stop', content: 'Basic cap synthesis.' })
      )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, '(BASIC) Basic cap synthesis.', 'COMPLETED')
  })

  // ── (a) synthesis-call path — token limit ─────────────────────────────────

  it('(a) synthesis (token limit): prefixes with (BASIC) when env=true and tier=basic', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'true'
    mockAnalyze.mockResolvedValueOnce({ allowed: true, intent: 'surface', complexityScore: 20, category: 'basic' })
    mockResolveTierForScore.mockReturnValueOnce('basic')

    mockCreateTieredChatCompletion
      .mockResolvedValueOnce(
        makeLlmResponse({
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
          promptTokens: 60_000,
          completionTokens: 45_000, // 105K > TOKEN_SUMMARY_THRESHOLD (100K)
        })
      )
      .mockResolvedValueOnce(
        makeLlmResponse({ finishReason: 'stop', content: 'Token limit synthesis.' })
      )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, '(BASIC) Token limit synthesis.', 'COMPLETED')
  })

  // ── (a) synthesis-call path — post-dispatch tool cap ─────────────────────

  it('(a) synthesis (post-dispatch cap): prefixes with (ADVANCED) when env=true', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'true'
    // maxToolCalls=1: pre-dispatch check (toolCallCount=0 >= 1 is false) passes,
    // one tool is dispatched, post-dispatch check (toolCallCount=1 >= 1) fires.
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 1, status: 'RUNNING' })
    // Default beforeEach resolves 'advanced'.

    mockCreateTieredChatCompletion
      .mockResolvedValueOnce(
        makeLlmResponse({
          finishReason: 'tool_calls',
          content: null,
          toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
          promptTokens: 200,
          completionTokens: 100,
        })
      )
      .mockResolvedValueOnce(
        makeLlmResponse({ finishReason: 'stop', content: 'Post-dispatch synthesis.' })
      )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockDispatchTool).toHaveBeenCalledTimes(1)
    expect(mockCompleteSession).toHaveBeenCalledWith(1, '(ADVANCED) Post-dispatch synthesis.', 'COMPLETED')
  })

  // ── (b) env unset / false — no tag ───────────────────────────────────────

  it('(b) applies no tag when AI_CHAT_DEBUG_TIER_TAG is unset', async () => {
    delete process.env.AI_CHAT_DEBUG_TIER_TAG
    // Default beforeEach resolves 'advanced'.

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Plain answer.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Plain answer.', 'COMPLETED')
  })

  it('(b) applies no tag when AI_CHAT_DEBUG_TIER_TAG is "false"', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'false'

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Plain answer.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Plain answer.', 'COMPLETED')
  })

  it('(b) applies no tag on synthesis path when env is unset', async () => {
    delete process.env.AI_CHAT_DEBUG_TIER_TAG
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 0, status: 'RUNNING' })

    mockCreateTieredChatCompletion
      .mockResolvedValueOnce(
        makeLlmResponse({
          finishReason: 'tool_calls',
          content: 'Checking.',
          toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        })
      )
      .mockResolvedValueOnce(
        makeLlmResponse({ finishReason: 'stop', content: 'Untagged synthesis.' })
      )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Untagged synthesis.', 'COMPLETED')
  })

  // ── (c) sessionTier=undefined — no tag even with env=true ────────────────

  it('(c) applies no tag when sessionTier is undefined even if env=true (off-topic / null score)', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'true'
    mockAnalyze.mockResolvedValueOnce({
      allowed: false,
      intent: 'surface',
      complexityScore: null,
      category: 'off_topic',
    })
    mockResolveTierForScore.mockReturnValueOnce(undefined)

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Off-topic response.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Off-topic response.', 'COMPLETED')
  })

  it('(c) applies no tag on synthesis path when sessionTier is undefined and env=true', async () => {
    process.env.AI_CHAT_DEBUG_TIER_TAG = 'true'
    mockAnalyze.mockResolvedValueOnce({
      allowed: false,
      intent: 'surface',
      complexityScore: null,
      category: 'off_topic',
    })
    mockResolveTierForScore.mockReturnValueOnce(undefined)
    // Cap=0 forces synthesis path.
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 0, status: 'RUNNING' })

    mockCreateTieredChatCompletion
      .mockResolvedValueOnce(
        makeLlmResponse({
          finishReason: 'tool_calls',
          content: 'Checking.',
          toolCalls: [{ id: 'tc1', name: 'planner_get_tasks', args: '{}' }],
        })
      )
      .mockResolvedValueOnce(
        makeLlmResponse({ finishReason: 'stop', content: 'Untagged synthesis undefined tier.' })
      )

    await runAgentOrchestrator(BASE_OPTS)

    expect(mockCompleteSession).toHaveBeenCalledWith(1, 'Untagged synthesis undefined tier.', 'COMPLETED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: Current date/time injection into the system prompt
//
// The orchestrator must inject the real current date at request time so the
// model can correctly resolve relative phrases like "tomorrow" or "next Friday".
//
// Coverage:
//  (a) The system prompt message sent to createTieredChatCompletion contains
//      the date context section for all four modules.
//  (b) The injected date reflects the actual system clock at request time
//      (tested by mocking Date and asserting the formatted string matches).
//  (c) The date is always expressed in UTC (no per-user timezone field exists).
//  (d) buildCurrentDateContext() itself correctly formats from the system clock.
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentOrchestrator — current date/time injection (Suite 6)', () => {
  // Restore real timers after each test so fake timers don't bleed.
  afterEach(() => {
    jest.useRealTimers()
  })

  // ── (a) Date context section present in the system prompt ─────────────────

  it('(a) PLANNER session: system prompt contains the date context section', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    type Msg = { role: string; content?: string }
    const systemMsg = (
      mockCreateTieredChatCompletion.mock.calls[0][1].messages as Msg[]
    ).find(m => m.role === 'system')

    expect(systemMsg).toBeDefined()
    // The section header must be present.
    expect(systemMsg!.content).toContain('## Current date and time')
    // The marker phrase from buildCurrentDateContext must be present.
    expect(systemMsg!.content).toContain('Today is')
    expect(systemMsg!.content).toContain('UTC')
    expect(systemMsg!.content).toContain('relative date phrases')
  })

  it('(a) GPA session: system prompt contains the date context section', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator({ ...BASE_OPTS, module: 'GPA' })

    type Msg = { role: string; content?: string }
    const systemMsg = (
      mockCreateTieredChatCompletion.mock.calls[0][1].messages as Msg[]
    ).find(m => m.role === 'system')

    expect(systemMsg!.content).toContain('## Current date and time')
    expect(systemMsg!.content).toContain('Today is')
    expect(systemMsg!.content).toContain('UTC')
  })

  it('(a) ROADMAP session: system prompt contains the date context section', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator({ ...BASE_OPTS, module: 'ROADMAP' })

    type Msg = { role: string; content?: string }
    const systemMsg = (
      mockCreateTieredChatCompletion.mock.calls[0][1].messages as Msg[]
    ).find(m => m.role === 'system')

    expect(systemMsg!.content).toContain('## Current date and time')
    expect(systemMsg!.content).toContain('Today is')
    expect(systemMsg!.content).toContain('UTC')
  })

  it('(a) CHAT session: system prompt contains the date context section', async () => {
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator({ ...BASE_OPTS, module: 'CHAT' })

    type Msg = { role: string; content?: string }
    const systemMsg = (
      mockCreateTieredChatCompletion.mock.calls[0][1].messages as Msg[]
    ).find(m => m.role === 'system')

    expect(systemMsg!.content).toContain('## Current date and time')
    expect(systemMsg!.content).toContain('Today is')
    expect(systemMsg!.content).toContain('UTC')
  })

  // ── (b) Injected date reflects real system clock at request time ───────────

  it('(b) injected date matches the system clock — mocked to a known timestamp', async () => {
    // 2026-07-17T15:30:00Z is a Friday.
    const MOCK_TIMESTAMP = new Date('2026-07-17T15:30:00Z')
    jest.useFakeTimers()
    jest.setSystemTime(MOCK_TIMESTAMP)

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )

    await runAgentOrchestrator(BASE_OPTS)

    type Msg = { role: string; content?: string }
    const systemMsg = (
      mockCreateTieredChatCompletion.mock.calls[0][1].messages as Msg[]
    ).find(m => m.role === 'system')

    expect(systemMsg!.content).toContain('Friday')
    expect(systemMsg!.content).toContain('July 17, 2026')
    expect(systemMsg!.content).toContain('15:30 UTC')
  })

  it('(b) injected date changes when the clock changes — two sessions at different times', async () => {
    // First session at 2026-01-01T00:00:00Z (Thursday, January 1, 2026).
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )
    await runAgentOrchestrator(BASE_OPTS)

    type Msg = { role: string; content?: string }
    const systemMsgFirst = (
      mockCreateTieredChatCompletion.mock.calls[0][1].messages as Msg[]
    ).find(m => m.role === 'system')
    expect(systemMsgFirst!.content).toContain('January 1, 2026')

    jest.clearAllMocks()
    // Reset default mocks removed by clearAllMocks.
    mockSessionFindUnique.mockResolvedValue({ maxToolCalls: 12, status: 'RUNNING' })
    mockDispatchTool.mockResolvedValue({ success: true, output: { result: 'ok' } })
    mockCompleteSession.mockResolvedValue(undefined)
    mockToolCallCreate.mockResolvedValue({ id: 99 })
    mockToolCallUpdate.mockResolvedValue({})
    mockAnalyze.mockResolvedValue({ allowed: true, intent: 'surface', complexityScore: 75, category: 'college_admissions' })
    mockResolveTierForScore.mockReturnValue('advanced')

    // Second session at 2026-07-17T15:30:00Z (Friday, July 17, 2026).
    jest.setSystemTime(new Date('2026-07-17T15:30:00Z'))
    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )
    await runAgentOrchestrator(BASE_OPTS)

    const systemMsgSecond = (
      mockCreateTieredChatCompletion.mock.calls[0][1].messages as Msg[]
    ).find(m => m.role === 'system')
    expect(systemMsgSecond!.content).toContain('July 17, 2026')
    // The two dates must differ — this confirms the value is computed fresh.
    expect(systemMsgFirst!.content).not.toContain('July 17, 2026')
    expect(systemMsgSecond!.content).not.toContain('January 1, 2026')
  })

  // ── (c) UTC is always used — no per-user timezone drift ───────────────────

  it('(c) injected date context always uses UTC regardless of environment timezone', async () => {
    // 2026-07-17T23:45:00Z: in UTC this is still July 17, but east-coast US
    // (UTC-4) it would be 19:45 on July 17, while UTC+9 (Japan) it's already
    // 08:45 on July 18. We assert the UTC date is what appears, not a localised one.
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-17T23:45:00Z'))

    mockCreateTieredChatCompletion.mockResolvedValueOnce(
      makeLlmResponse({ finishReason: 'stop', content: 'Done.' })
    )
    await runAgentOrchestrator(BASE_OPTS)

    type Msg = { role: string; content?: string }
    const systemMsg = (
      mockCreateTieredChatCompletion.mock.calls[0][1].messages as Msg[]
    ).find(m => m.role === 'system')

    // Must show July 17 (UTC), not July 18 (some +offset timezones).
    expect(systemMsg!.content).toContain('July 17, 2026')
    expect(systemMsg!.content).toContain('23:45 UTC')
    expect(systemMsg!.content).toContain('UTC')
  })

  // ── (d) buildCurrentDateContext() unit tests ──────────────────────────────

  it('(d) buildCurrentDateContext() returns a string containing the day of week, date, time and UTC marker', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-17T15:30:00Z'))

    const context = buildCurrentDateContext()

    expect(context).toContain('Friday')
    expect(context).toContain('July 17, 2026')
    expect(context).toContain('15:30 UTC')
    expect(context).toContain('relative date phrases')
    expect(context).toContain('tomorrow')
  })

  it('(d) buildCurrentDateContext() zero-pads hours and minutes correctly (e.g. 09:05 not 9:5)', () => {
    jest.useFakeTimers()
    // 9:05 AM UTC — both hours and minutes need zero-padding.
    jest.setSystemTime(new Date('2026-07-17T09:05:00Z'))

    const context = buildCurrentDateContext()

    expect(context).toContain('09:05 UTC')
    // Must not appear as un-padded.
    expect(context).not.toMatch(/\b9:5\b/)
  })

  it('(d) buildCurrentDateContext() midnight UTC formats as 00:00', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-17T00:00:00Z'))

    const context = buildCurrentDateContext()

    expect(context).toContain('00:00 UTC')
  })
})
