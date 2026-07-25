/**
 * Integration tests for agentSessions route — focused on Bug 1 (waitUntil)
 * and the POST /ai/agent/session contract.
 *
 * Key assertion: the route must call waitUntil() from @vercel/functions to
 * keep the serverless function alive until the orchestrator promise settles,
 * rather than relying on undefined fire-and-forget behaviour that Vercel can
 * cut off immediately after the HTTP response is sent.
 *
 * Mocked: @vercel/functions, agentExecution.service (startSession),
 *         agentOrchestrator (runAgentOrchestrator), prisma, auditLog.
 * Auth: real JWT signed with the test secret (same pattern as ai.test.ts).
 */

// ── Mock: @vercel/functions ────────────────────────────────────────────────────
// Must be hoisted before any module that imports agentSessions.ts.

const mockWaitUntil = jest.fn()

jest.mock('@vercel/functions', () => ({
  waitUntil: (...args: unknown[]) => mockWaitUntil(...args),
}))

jest.mock('../../middleware/requireActiveAccount', () => ({
  requireActiveAccount: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// ── Mock: Prisma ──────────────────────────────────────────────────────────────

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    agentSession: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    agentToolCall: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    complianceAuditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    refreshToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    passwordResetToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    emailOTP: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    schoolConnection: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
}))

// ── Mock: AgentExecution service ──────────────────────────────────────────────

const mockStartSession = jest.fn()

jest.mock('../../services/agent/agentExecution.service', () => ({
  startSession: (...args: unknown[]) => mockStartSession(...args),
  completeSession: jest.fn().mockResolvedValue(undefined),
}))

// ── Mock: AgentOrchestrator ───────────────────────────────────────────────────

const mockRunAgentOrchestrator = jest.fn()

jest.mock('../../services/agent/agentOrchestrator', () => ({
  runAgentOrchestrator: (...args: unknown[]) => mockRunAgentOrchestrator(...args),
}))

// ── Mock: Audit log ───────────────────────────────────────────────────────────

jest.mock('../../lib/auditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

// ── Mock: AI client (referenced by other modules loaded by app) ────────────────

jest.mock('../../lib/aiClient', () => ({
  createChatCompletion: jest.fn(),
  createTieredChatCompletion: jest.fn(),
  resolveTierForScore: jest.fn().mockReturnValue(undefined),
  getAiClient: jest.fn(),
  getAiModel: jest.fn().mockReturnValue('test-model'),
}))

// ── Mock: Intent router (referenced by agentOrchestrator) ─────────────────────

jest.mock('../../services/ai/intentRouter', () => ({
  chatIntentRouter: {
    analyze: jest.fn().mockResolvedValue({
      allowed: true,
      intent: 'surface',
      complexityScore: 75,
      category: 'college_admissions',
    }),
  },
  ChatIntentRouter: jest.fn(),
}))

// ── Mock: Student context (referenced by personalized chat) ───────────────────

jest.mock('../../lib/studentContext', () => ({
  getPortalData: jest.fn().mockResolvedValue(null),
  deriveGradeLevel: jest.fn().mockReturnValue(null),
}))

// ─────────────────────────────────────────────────────────────────────────────

import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../../app'
import { prisma } from '../../lib/prisma'

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = 'test-secret-for-jest-suite'
const TEST_USER_ID = 42

// A fully-consented user satisfies requireConsent middleware.
const FAKE_CONSENTED_USER = {
  id: TEST_USER_ID,
  name: 'Test Student',
  tosAcceptedAt: new Date('2024-01-01'),
  privacyAcceptedAt: new Date('2024-01-01'),
  ageConfirmedAt: new Date('2024-01-01'),
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeAuthToken(): string {
  return jwt.sign({ sub: TEST_USER_ID }, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  })
}

// Cast through unknown to avoid deep Prisma delegate types in test code.
const mockUserFindUnique = prisma.user.findUnique as unknown as jest.Mock

// ── Lifecycle ──────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET
})

afterAll(() => {
  delete process.env.JWT_SECRET
})

beforeEach(() => {
  jest.clearAllMocks()
  // Default: fully-consented user so requireConsent middleware passes.
  mockUserFindUnique.mockResolvedValue(FAKE_CONSENTED_USER)
  // Default: startSession returns a running session with no block.
  mockStartSession.mockResolvedValue({ sessionId: 123 })
  // Default: orchestrator resolves immediately (the real one is async / long-running).
  mockRunAgentOrchestrator.mockResolvedValue(undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite: POST /ai/agent/session — Bug 1 (waitUntil)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /ai/agent/session — waitUntil (Bug 1)', () => {
  it('responds 201 and calls waitUntil with the orchestrator promise', async () => {
    const res = await request(app)
      .post('/ai/agent/session')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ module: 'CHAT', userMessage: 'how can i make my common app essay stand out' })

    expect(res.status).toBe(201)
    expect(res.body.data.sessionId).toBe(123)
    expect(res.body.data.status).toBe('RUNNING')

    // Core assertion: waitUntil must be called exactly once with the
    // orchestrator promise — not with void/undefined and not skipped.
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
    const passedArg: unknown = mockWaitUntil.mock.calls[0][0]
    // waitUntil receives the chained .catch() promise, which is a Promise object.
    expect(passedArg).toBeInstanceOf(Promise)
  })

  it('returns 401 when no Authorization header is present', async () => {
    const res = await request(app)
      .post('/ai/agent/session')
      .send({ module: 'CHAT', userMessage: 'test' })

    expect(res.status).toBe(401)
    // waitUntil must not be called when auth fails.
    expect(mockWaitUntil).not.toHaveBeenCalled()
  })

  it('returns 422 for invalid input and does not call waitUntil or startSession', async () => {
    const res = await request(app)
      .post('/ai/agent/session')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ module: 'INVALID_MODULE', userMessage: 'test' })

    expect(res.status).toBe(422)
    expect(mockStartSession).not.toHaveBeenCalled()
    expect(mockWaitUntil).not.toHaveBeenCalled()
  })

  it('returns 403 when startSession blocks on COPPA_GATE and does not call waitUntil', async () => {
    mockStartSession.mockResolvedValueOnce({ sessionId: -1, blockedReason: 'COPPA_GATE' })

    const res = await request(app)
      .post('/ai/agent/session')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ module: 'CHAT', userMessage: 'hello' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('COPPA_BLOCKED')
    expect(mockWaitUntil).not.toHaveBeenCalled()
  })

  it('calls runAgentOrchestrator with the correct parameters before passing to waitUntil', async () => {
    const res = await request(app)
      .post('/ai/agent/session')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ module: 'PLANNER', userMessage: 'What tasks do I have this week?' })

    expect(res.status).toBe(201)

    // The orchestrator must be invoked with the right options.
    expect(mockRunAgentOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 123,
        userId: TEST_USER_ID,
        module: 'PLANNER',
        trigger: 'USER',
        userMessage: 'What tasks do I have this week?',
      }),
    )

    // waitUntil must wrap the result — called exactly once.
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
  })

  it('still calls waitUntil even when the orchestrator rejects (error caught inside the promise)', async () => {
    // Simulate an orchestrator that throws. The .catch() inside the route
    // handles this — waitUntil still receives the settled (rejected→caught) promise.
    mockRunAgentOrchestrator.mockRejectedValueOnce(new Error('Orchestrator blew up'))

    const res = await request(app)
      .post('/ai/agent/session')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ module: 'CHAT', userMessage: 'hello' })

    // The 201 is sent before the orchestrator settles, so it is unaffected.
    expect(res.status).toBe(201)

    // waitUntil is called — the promise passed to it is the chained .catch()
    // which catches the rejection and resolves to undefined.
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
  })
})
