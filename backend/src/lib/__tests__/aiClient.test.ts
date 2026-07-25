// jest.mock() calls are hoisted before all imports by ts-jest — the factories
// run when the mocked module is first required, which is before any test body.

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }))

jest.mock('../aiRequestContext', () => ({
  shouldSkipPrimaryModel: jest.fn().mockReturnValue(false),
  markFallbackUsed: jest.fn(),
}))

jest.mock('../../common/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import { resolveTierForScore, createTieredChatCompletion } from '../aiClient'
import { shouldSkipPrimaryModel, markFallbackUsed } from '../aiRequestContext'

const MockOpenAI = jest.mocked(OpenAI)
const mockShouldSkip = jest.mocked(shouldSkipPrimaryModel)
const mockMarkFallback = jest.mocked(markFallbackUsed)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeChatCompletion(content = 'ok'): ChatCompletion {
  return {
    id: 'test-id',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    choices: [{
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content, refusal: null },
    }],
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
  }
}

// Build a minimal OpenAI instance stub wired to the given jest.fn().
function makeClientStub(createFn: jest.Mock): OpenAI {
  return {
    chat: { completions: { create: createFn } },
  } as unknown as OpenAI
}

const BASIC_PARAMS = {
  messages: [{ role: 'user' as const, content: 'Hello' }],
  max_tokens: 100,
}

// ---------------------------------------------------------------------------
// Env helpers — restore on teardown
// ---------------------------------------------------------------------------

function setEnv(vars: Record<string, string | undefined>): () => void {
  const original: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k]
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }
  return () => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// ---------------------------------------------------------------------------
// resolveTierForScore
// ---------------------------------------------------------------------------

describe('resolveTierForScore', () => {
  it('returns undefined when score is null (blocked/off-topic prompt)', () => {
    expect(resolveTierForScore(null)).toBeUndefined()
  })

  it("returns 'basic' for score 1 (bottom of basic band)", () => {
    expect(resolveTierForScore(1)).toBe('basic')
  })

  it("returns 'basic' for score 50 (top of basic band)", () => {
    expect(resolveTierForScore(50)).toBe('basic')
  })

  it("returns 'advanced' for score 51 (bottom of advanced band)", () => {
    expect(resolveTierForScore(51)).toBe('advanced')
  })

  it("returns 'advanced' for score 100 (top of advanced band)", () => {
    expect(resolveTierForScore(100)).toBe('advanced')
  })
})

// ---------------------------------------------------------------------------
// createTieredChatCompletion
// ---------------------------------------------------------------------------

// Mirrors the production constant so we can advance fake time past the
// cooldown window between tests, preventing any circuit opened in test N from
// bleeding into test N+1.
const CIRCUIT_COOLDOWN_MS = 3 * 60 * 1000

// A stable starting epoch (Nov 2023). Incremented by >CIRCUIT_COOLDOWN_MS
// before each test so the module-level `advancedTierCircuitOpenUntil` value
// left by a prior test is always in the past when the next test begins.
let currentTestTime = 1_700_000_000_000

describe('createTieredChatCompletion', () => {
  let restoreEnv: () => void

  beforeEach(() => {
    // Install fake timers and pin Date.now() to a value that is guaranteed to
    // be past the cooldown window set by any previous test, so module-level
    // circuit state never leaks across test boundaries (Bug 2 fix).
    jest.useFakeTimers()
    jest.setSystemTime(currentTestTime)
    currentTestTime += CIRCUIT_COOLDOWN_MS + 5_000

    jest.clearAllMocks()
    mockShouldSkip.mockReturnValue(false)
    restoreEnv = () => { /* overridden per-test below */ }
  })

  afterEach(() => {
    jest.useRealTimers()
    restoreEnv()
  })

  // (a) basic tier routes to OpenRouter with the basic model
  it('(a) basic tier calls the OpenRouter client with the basic model', async () => {
    restoreEnv = setEnv({
      OPENROUTER_API_KEY: 'or-test-key',
      AI_MODEL_BASIC: 'test/basic-model',
      NVIDIA_API_KEY: undefined,
    })

    const mockCreate = jest.fn().mockResolvedValue(makeFakeChatCompletion())
    MockOpenAI.mockImplementation(() => makeClientStub(mockCreate))

    await createTieredChatCompletion('basic', BASIC_PARAMS)

    // Constructor must have been called with the OpenRouter baseURL and key
    expect(MockOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'or-test-key',
    }))

    // create() must have been called once with the configured basic model
    // (no second options arg — basic tier has no fail-fast timeout)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test/basic-model' }),
    )
  })

  // (b) advanced tier with NVIDIA_API_KEY set calls the NVIDIA client
  it('(b) advanced tier with NVIDIA_API_KEY set calls the NVIDIA client with NVIDIA_MODEL', async () => {
    restoreEnv = setEnv({
      NVIDIA_API_KEY: 'nvapi-test-key',
      NVIDIA_MODEL: 'nvidia/deepseek-test',
      OPENROUTER_API_KEY: 'or-test-key',
    })

    const mockCreate = jest.fn().mockResolvedValue(makeFakeChatCompletion())
    MockOpenAI.mockImplementation(() => makeClientStub(mockCreate))

    await createTieredChatCompletion('advanced', BASIC_PARAMS)

    // At least one constructor call must have used the NVIDIA baseURL
    const nvidiaCall = MockOpenAI.mock.calls.find(
      ([opts]) => opts.baseURL === 'https://integrate.api.nvidia.com/v1'
    )
    expect(nvidiaCall).toBeDefined()
    expect(nvidiaCall?.[0]).toMatchObject({ apiKey: 'nvapi-test-key' })

    // create() called with the configured NVIDIA model
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'nvidia/deepseek-test' }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
  })

  // (c) advanced tier with NVIDIA_API_KEY absent falls through to basic/OpenRouter
  it('(c) advanced tier with NVIDIA_API_KEY absent falls through to OpenRouter basic tier', async () => {
    restoreEnv = setEnv({
      NVIDIA_API_KEY: undefined,
      OPENROUTER_API_KEY: 'or-test-key',
      AI_MODEL_BASIC: 'test/basic-model',
    })

    const mockCreate = jest.fn().mockResolvedValue(makeFakeChatCompletion())
    MockOpenAI.mockImplementation(() => makeClientStub(mockCreate))

    await createTieredChatCompletion('advanced', BASIC_PARAMS)

    // Must fall through to OpenRouter (no NVIDIA constructor call)
    const nvidiaCall = MockOpenAI.mock.calls.find(
      ([opts]) => opts.baseURL === 'https://integrate.api.nvidia.com/v1'
    )
    expect(nvidiaCall).toBeUndefined()

    const openRouterCall = MockOpenAI.mock.calls.find(
      ([opts]) => opts.baseURL === 'https://openrouter.ai/api/v1'
    )
    expect(openRouterCall).toBeDefined()

    // create() called once with the basic model (not NVIDIA model), no options arg
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test/basic-model' }),
    )
  })

  // (d) advanced tier primary throws → retries with the reliable fallback model
  it('(d) advanced tier primary NVIDIA call failure triggers retry with fallback model', async () => {
    const FALLBACK_MODEL = 'meta/llama-3.1-70b-instruct'

    restoreEnv = setEnv({
      NVIDIA_API_KEY: 'nvapi-test-key',
      // Use a primary model different from the fallback so hasFallback=true
      NVIDIA_MODEL: 'nvidia/deepseek-test',
      OPENROUTER_API_KEY: 'or-test-key',
    })

    const fallbackResult = makeFakeChatCompletion('fallback response')
    const mockCreate = jest.fn()
      // First call (primary) → throws
      .mockRejectedValueOnce(new Error('NIM capacity overloaded'))
      // Second call (fallback) → succeeds
      .mockResolvedValueOnce(fallbackResult)

    MockOpenAI.mockImplementation(() => makeClientStub(mockCreate))

    const result = await createTieredChatCompletion('advanced', BASIC_PARAMS)

    // Two calls total
    expect(mockCreate).toHaveBeenCalledTimes(2)

    // First call: primary model with fail-fast timeout
    expect(mockCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: 'nvidia/deepseek-test' }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    )

    // Second call: reliable fallback model
    expect(mockCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: FALLBACK_MODEL }),
    )

    // markFallbackUsed must have been called
    expect(mockMarkFallback).toHaveBeenCalled()

    // Final result is the fallback response
    expect(result.choices[0]?.message?.content).toBe('fallback response')
  })

  // (e) circuit breaker opened by a primary failure causes the NEXT, separate
  //     call to skip the primary entirely and go straight to the fallback.
  //     This is the key guarantee that distinguishes a real circuit breaker
  //     from a simple within-call retry — Bug 1 fix.
  it('(e) a subsequent advanced-tier call made while the circuit is open skips the primary and goes straight to the fallback model', async () => {
    const PRIMARY_MODEL = 'nvidia/deepseek-test'
    const FALLBACK_MODEL = 'meta/llama-3.1-70b-instruct'

    restoreEnv = setEnv({
      NVIDIA_API_KEY: 'nvapi-test-key',
      NVIDIA_MODEL: PRIMARY_MODEL,
      OPENROUTER_API_KEY: 'or-test-key',
    })

    const fallbackResult = makeFakeChatCompletion('fallback response from open circuit')
    const mockCreate = jest.fn()
      // Call 1 within the first request: primary throws, opening the circuit
      .mockRejectedValueOnce(new Error('NIM capacity overloaded'))
      // All subsequent calls (the in-request fallback + the second request's
      // single call) succeed with the fallback result
      .mockResolvedValue(fallbackResult)

    MockOpenAI.mockImplementation(() => makeClientStub(mockCreate))

    // ── First request: primary throws, circuit opens ──────────────────────
    // Fake time is at currentTestTime (set in beforeEach). After this call,
    // advancedTierCircuitOpenUntil = currentTestTime + CIRCUIT_COOLDOWN_MS.
    await createTieredChatCompletion('advanced', BASIC_PARAMS)

    // Verify the circuit is open: the first request consumed 2 create() calls
    // (1 primary failure + 1 in-request fallback retry).
    expect(mockCreate).toHaveBeenCalledTimes(2)

    // ── Isolate the second request's calls ────────────────────────────────
    // Clear call history WITHOUT advancing fake time — Date.now() is still
    // inside the circuit's cooldown window.
    mockCreate.mockClear()
    jest.clearAllMocks()
    // Re-apply shouldSkipPrimaryModel = false so the per-request context
    // signal doesn't influence the result (we want to prove only the shared
    // circuit state drives the skip).
    mockShouldSkip.mockReturnValue(false)

    // ── Second request: circuit is still open ────────────────────────────
    const result = await createTieredChatCompletion('advanced', BASIC_PARAMS)

    // Exactly ONE create() call for the entire second request — the primary
    // model was skipped entirely, not attempted first.
    expect(mockCreate).toHaveBeenCalledTimes(1)

    // That single call must have used the reliable fallback, not the primary.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: FALLBACK_MODEL }),
    )
    expect(mockCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ model: PRIMARY_MODEL }),
      expect.anything(),
    )

    expect(result.choices[0]?.message?.content).toBe('fallback response from open circuit')
  })
})
