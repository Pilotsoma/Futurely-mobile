/**
 * Integration tests for the cron route — GET /cron/assignment-reminders.
 *
 * The route is mounted in app.ts at /cron (no requireAuth/requireConsent),
 * reachable externally at /api/cron/assignment-reminders via vercel.json's
 * /api routePrefix.
 *
 * Coverage:
 *   - Missing Authorization header → 401
 *   - Wrong secret value → 401
 *   - Correct secret → 200, calls checkAndSendReminders, returns { processed: N }
 *   - Service throws → 500 with INTERNAL_ERROR
 *
 * Mocked: checkAndSendReminders (the service), and all modules transitively
 * loaded by app.ts that require external services (prisma, @vercel/functions,
 * AI clients, etc.).
 */

// ── Mock: @vercel/functions ────────────────────────────────────────────────────

jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

// ── Mock: Prisma ──────────────────────────────────────────────────────────────

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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
    complianceAuditLog: { create: jest.fn().mockResolvedValue({}) },
    refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    passwordResetToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    emailOTP: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
    oauthAccount: { findUnique: jest.fn().mockResolvedValue(null) },
    assignment: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    notification: { create: jest.fn().mockResolvedValue({ id: 1 }) },
  },
}))

// ── Mock: AI client ───────────────────────────────────────────────────────────

jest.mock('../../lib/aiClient', () => ({
  createTieredChatCompletion: jest.fn(),
  resolveTierForScore: jest.fn(),
}))

// ── Mock: Intent router ───────────────────────────────────────────────────────

jest.mock('../../services/ai/intentRouter', () => ({
  chatIntentRouter: { analyze: jest.fn() },
}))

// ── Mock: Agent execution service ────────────────────────────────────────────

jest.mock('../../services/agent/agentExecution.service', () => ({
  startSession: jest.fn(),
  completeSession: jest.fn(),
  dispatchTool: jest.fn(),
}))

// ── Mock: Agent orchestrator ──────────────────────────────────────────────────

jest.mock('../../services/agent/agentOrchestrator', () => ({
  runAgentOrchestrator: jest.fn(),
  buildCurrentDateContext: jest.fn().mockReturnValue(''),
}))

// ── Mock: checkAndSendReminders ───────────────────────────────────────────────
//
// Must come before app is imported so the mock is in place when cron.ts is
// first evaluated.

const mockCheckAndSendReminders = jest.fn()

jest.mock('../../services/assignmentReminder.service', () => ({
  checkAndSendReminders: (...args: unknown[]) => mockCheckAndSendReminders(...args),
}))

// ── Subject under test ────────────────────────────────────────────────────────

import request from 'supertest'
import app from '../../app'

// ── Constants ─────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret-abc'
const ENDPOINT = '/cron/assignment-reminders'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /cron/assignment-reminders — cron auth', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = CRON_SECRET
  })

  afterAll(() => {
    delete process.env.CRON_SECRET
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when the Authorization header is absent', async () => {
    const res = await request(app).get(ENDPOINT)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
    expect(mockCheckAndSendReminders).not.toHaveBeenCalled()
  })

  it('returns 401 when the Authorization header has the wrong secret', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', 'Bearer wrong-secret')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
    expect(mockCheckAndSendReminders).not.toHaveBeenCalled()
  })

  it('returns 401 when the Authorization header is malformed (no "Bearer " prefix)', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', CRON_SECRET)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
    expect(mockCheckAndSendReminders).not.toHaveBeenCalled()
  })

  it('returns 200 and calls checkAndSendReminders when the correct secret is supplied', async () => {
    mockCheckAndSendReminders.mockResolvedValue({ processed: 3 })

    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { processed: 3 } })
    expect(mockCheckAndSendReminders).toHaveBeenCalledTimes(1)
  })

  it('returns 500 when checkAndSendReminders throws', async () => {
    mockCheckAndSendReminders.mockRejectedValue(new Error('DB unavailable'))

    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
  })

  it('does not accept a normal user JWT in place of the cron secret', async () => {
    // A valid JWT token is not a valid CRON_SECRET; the header value must be
    // exactly `Bearer <CRON_SECRET>`.
    const fakeJwt = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.fake'

    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', fakeJwt)

    expect(res.status).toBe(401)
    expect(mockCheckAndSendReminders).not.toHaveBeenCalled()
  })
})
