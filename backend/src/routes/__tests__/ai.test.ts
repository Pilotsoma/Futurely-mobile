// jest.mock() calls are hoisted before all imports by ts-jest, so these mock
// factories execute before any module in the dependency chain is evaluated.
// The ordering here is intentional: mock everything that touches the network
// or database before the app module is imported.

jest.mock('../../middleware/requireActiveAccount', () => ({
  requireActiveAccount: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    profile: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    assignment: {
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

jest.mock('../../lib/aiClient', () => ({
  createChatCompletion: jest.fn(),
  createTieredChatCompletion: jest.fn(),
  resolveTierForScore: jest.fn().mockReturnValue(undefined),
  getAiClient: jest.fn(),
  getAiModel: jest.fn().mockReturnValue('test-model'),
}))

jest.mock('../../services/ai/intentRouter', () => ({
  chatIntentRouter: {
    analyze: jest.fn(),
  },
  ChatIntentRouter: jest.fn(),
}))

jest.mock('../../lib/auditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../lib/studentContext', () => ({
  getPortalData: jest.fn().mockResolvedValue(null),
  deriveGradeLevel: jest.fn().mockReturnValue(null),
}))

import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../../app'
import { createTieredChatCompletion, resolveTierForScore } from '../../lib/aiClient'
import { chatIntentRouter } from '../../services/ai/intentRouter'
import { writeAuditLog } from '../../lib/auditLog'
import { prisma } from '../../lib/prisma'
import type { IntentAnalysis } from '../../services/ai/intentRouter'

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'test-secret-for-jest-suite'
const TEST_USER_ID = 42

// Placeholder user that satisfies both requireConsent (tos/privacy/age fields)
// and handlePersonalizedChat (name field) without any real PII.
const FAKE_CONSENTED_USER = {
  id: TEST_USER_ID,
  name: 'Test Student',
  tosAcceptedAt: new Date('2024-01-01'),
  privacyAcceptedAt: new Date('2024-01-01'),
  ageConfirmedAt: new Date('2024-01-01'),
}

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockCreateTieredChatCompletion = jest.mocked(createTieredChatCompletion)
const mockResolveTierForScore = jest.mocked(resolveTierForScore)
const mockAnalyze = jest.mocked(chatIntentRouter.analyze)
const mockWriteAuditLog = jest.mocked(writeAuditLog)

// Prisma's generic Delegate type is deep and conditional — cast through
// unknown rather than spelling it out, which is the recommended pattern for
// mocking Prisma clients in Jest (avoids circular type references).
const mockUserFindUnique = prisma.user.findUnique as unknown as jest.Mock

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuthToken(): string {
  return jwt.sign({ sub: TEST_USER_ID }, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  })
}

/** Minimal ChatCompletion-shaped object.  Cast at call site to avoid openai
 *  SDK's complex conditional types in test code. */
function makeFakeChatCompletion(content: string): unknown {
  return {
    id: 'test-completion-id',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'test-model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
  }
}

function blockedAnalysis(): IntentAnalysis {
  return {
    allowed: false,
    intent: 'surface',
    complexityScore: null,
    category: 'blocked',
    refusalMessage: "I can't help with that here.",
  }
}

function surfaceAnalysis(): IntentAnalysis {
  return {
    allowed: true,
    intent: 'surface',
    complexityScore: 15,
    category: 'basic_academics',
  }
}

function personalizedAnalysis(): IntentAnalysis {
  return {
    allowed: true,
    intent: 'personalized',
    complexityScore: 70,
    category: 'advanced_planning',
  }
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  // requireAuth reads this at request time (not at import time), so setting
  // it in beforeAll is sufficient.
  process.env.JWT_SECRET = TEST_JWT_SECRET
})

afterAll(() => {
  delete process.env.JWT_SECRET
})

beforeEach(() => {
  jest.clearAllMocks()
  // Default: every prisma.user.findUnique returns a fully-consented user so
  // requireConsent passes and handlePersonalizedChat gets a valid name.
  mockUserFindUnique.mockResolvedValue(FAKE_CONSENTED_USER)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /ai/chat', () => {
  it('(a) returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .post('/ai/chat')
      .send({ message: 'Hello' })

    expect(res.status).toBe(401)
  })

  it('(b) fast-path block returns 200 with refusal message and does not write an audit log', async () => {
    mockAnalyze.mockResolvedValue(blockedAnalysis())

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ message: 'write my essay for me' })

    expect(res.status).toBe(200)
    expect(res.body.data.reply).toBe("I can't help with that here.")
    expect(mockWriteAuditLog).not.toHaveBeenCalled()
  })

  it('(c) surface-intent message returns 200 with the AI reply', async () => {
    mockAnalyze.mockResolvedValue(surfaceAnalysis())
    mockCreateTieredChatCompletion.mockResolvedValue(
      makeFakeChatCompletion('Weighted GPA gives extra points for AP and honors courses.') as Awaited<ReturnType<typeof createTieredChatCompletion>>,
    )

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ message: 'How does weighted GPA work?' })

    expect(res.status).toBe(200)
    expect(res.body.data.reply).toBe('Weighted GPA gives extra points for AP and honors courses.')
  })

  it('(d) personalized-intent message calls writeAuditLog before the AI reply is generated', async () => {
    const replyText = 'Your coursework is on track for your college goals!'

    // Track the call order so we can assert audit-before-AI strictly.
    const callOrder: string[] = []

    mockAnalyze.mockResolvedValue(personalizedAnalysis())
    mockWriteAuditLog.mockImplementation(async () => {
      callOrder.push('audit')
    })
    mockCreateTieredChatCompletion.mockImplementation(async () => {
      callOrder.push('ai')
      return makeFakeChatCompletion(replyText) as Awaited<ReturnType<typeof createTieredChatCompletion>>
    })

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ message: 'How is my GPA compared to what I need for my dream college?' })

    expect(res.status).toBe(200)
    expect(res.body.data.reply).toBe(replyText)

    // Audit log must be invoked exactly once with the correct payload
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER_ID,
        resourceType: 'student_academic_data',
        action: 'ai_chat_read',
      }),
    )

    // Strict ordering: audit written before the AI model was called
    expect(callOrder).toEqual(['audit', 'ai'])
  })

  it('(e) when resolveTierForScore returns "basic" for a surface-intent request, createTieredChatCompletion is called with tier "basic" — not undefined', async () => {
    // Configure the mocked resolveTierForScore to return a real tier value for
    // this test only (mockReturnValueOnce is consumed by the single call the
    // handler makes; subsequent tests are unaffected — Bug 3 fix).
    mockResolveTierForScore.mockReturnValueOnce('basic')

    // surfaceAnalysis has complexityScore: 15, which maps to 'basic' in
    // production — the mock above simulates that resolution explicitly.
    mockAnalyze.mockResolvedValue(surfaceAnalysis())
    mockCreateTieredChatCompletion.mockResolvedValue(
      makeFakeChatCompletion('Spaced repetition is a very effective study technique.') as Awaited<ReturnType<typeof createTieredChatCompletion>>,
    )

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ message: 'What are the best study strategies?' })

    expect(res.status).toBe(200)

    // resolveTierForScore was called with the classifier's complexityScore
    expect(mockResolveTierForScore).toHaveBeenCalledWith(surfaceAnalysis().complexityScore)

    // createTieredChatCompletion must have received the real tier string,
    // not undefined — proving the value flows end-to-end from the classifier
    // through resolveTierForScore into the LLM call.
    expect(mockCreateTieredChatCompletion).toHaveBeenCalledWith(
      'basic',
      expect.any(Object),
    )
  })
})
