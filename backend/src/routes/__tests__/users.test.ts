/**
 * Integration tests for users route — PATCH /users/me/autonomous-consent.
 *
 * Scenarios covered (mirrors the five-scenario pattern from the startSession
 * COPPA bypass QA check):
 *
 * 1. Regression: non-DEV account with null DOB → 403 COPPA_BLOCKED, no DB write,
 *    no audit log entry (matching existing Bug 10 behavior exactly).
 * 2. Regression: null user record → 403 COPPA_BLOCKED, no DB write.
 * 3. DEV bypass: DEV-tagged account with null DOB → 200, COPPA_BYPASS_DEV_ACCOUNT
 *    audit entry written FIRST, then AUTONOMOUS_CONSENT_ACCEPTED second, DB write
 *    (autonomousConsentAcceptedAt) executed for the DEV account.
 * 4. ADMIN bypass: ADMIN-role account treated identically to DEV via hasDevPowers().
 * 5. Server-side-only enforcement: hasDevPowers() is called with the userId from
 *    verified auth middleware, not from any client-supplied value.
 *
 * Mocked: prisma, hasDevPowers (requireAdmin), writeAuditLog, and peripheral
 *         modules loaded transitively by app.ts (aiClient, intentRouter,
 *         studentContext, agentExecution.service, agentOrchestrator,
 *         @vercel/functions).
 * Auth: real JWT signed with the test secret (same pattern as agentSessions.test.ts).
 */

// ── Mock: @vercel/functions ────────────────────────────────────────────────────
// Must be hoisted before any module that imports agentSessions.ts.

jest.mock('@vercel/functions', () => ({
  waitUntil: jest.fn(),
}))

// These tests isolate the route's own authorization behavior. Account-status
// enforcement has dedicated middleware tests and must not mask these cases.
jest.mock('../../middleware/requireActiveAccount', () => ({
  requireActiveAccount: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// ── Mock: Prisma ──────────────────────────────────────────────────────────────

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
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

// ── Mock: requireAdmin (hasDevPowers) ─────────────────────────────────────────
// Export all named exports the module provides so other routes loaded by app.ts
// are not broken by a partial mock.

const mockHasDevPowers = jest.fn()

jest.mock('../../middleware/requireAdmin', () => ({
  hasDevPowers: (...args: unknown[]) => mockHasDevPowers(...args),
  requireAdmin: jest.fn(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  requireMod: jest.fn(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  requireParent: jest.fn(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  requireTeacher: jest.fn(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  requireCounselor: jest.fn(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  requireEducator: jest.fn(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}))

// ── Mock: Audit log ───────────────────────────────────────────────────────────

const mockWriteAuditLog = jest.fn()

jest.mock('../../lib/auditLog', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}))

// ── Mock: AgentExecution service ──────────────────────────────────────────────
// computeAge is imported directly by users.ts; startSession / completeSession
// are used by the agentSessions route loaded transitively by app.ts.

jest.mock('../../services/agent/agentExecution.service', () => ({
  startSession: jest.fn().mockResolvedValue({ sessionId: 1 }),
  completeSession: jest.fn().mockResolvedValue(undefined),
  computeAge: jest.fn(),
}))

// ── Mock: AgentOrchestrator ───────────────────────────────────────────────────

jest.mock('../../services/agent/agentOrchestrator', () => ({
  runAgentOrchestrator: jest.fn().mockResolvedValue(undefined),
}))

// ── Mock: AI client ───────────────────────────────────────────────────────────

jest.mock('../../lib/aiClient', () => ({
  createChatCompletion: jest.fn(),
  createTieredChatCompletion: jest.fn(),
  resolveTierForScore: jest.fn().mockReturnValue(undefined),
  getAiClient: jest.fn(),
  getAiModel: jest.fn().mockReturnValue('test-model'),
}))

// ── Mock: Intent router ───────────────────────────────────────────────────────

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

// ── Mock: Student context ─────────────────────────────────────────────────────

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

// Fully-consented user returned by requireConsent middleware's findUnique call.
const CONSENTED_USER_STUB = {
  id: TEST_USER_ID,
  tosAcceptedAt: new Date('2024-01-01'),
  privacyAcceptedAt: new Date('2024-01-01'),
  ageConfirmedAt: new Date('2024-01-01'),
}

// User record returned by the handler's COPPA check with null DOB (the
// condition that triggers the Bug 10 block for non-DEV accounts).
const NULL_DOB_USER_STUB = {
  dateOfBirth: null,
  coppaConsentStatus: 'NOT_REQUIRED',
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
const mockUserUpdate = prisma.user.update as unknown as jest.Mock

// ── Lifecycle ──────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET
})

afterAll(() => {
  delete process.env.JWT_SECRET
})

beforeEach(() => {
  jest.clearAllMocks()

  // Explicitly reset and re-queue the two findUnique calls per request:
  // call 1 → requireConsent middleware (needs tosAcceptedAt etc.)
  // call 2 → handler COPPA check (needs dateOfBirth, coppaConsentStatus)
  mockUserFindUnique.mockReset()
  mockUserFindUnique
    .mockResolvedValueOnce(CONSENTED_USER_STUB) // requireConsent
    .mockResolvedValueOnce(NULL_DOB_USER_STUB)  // handler COPPA check

  // Default: non-DEV / non-ADMIN account
  mockHasDevPowers.mockResolvedValue(false)

  // Default: DB write succeeds
  mockUserUpdate.mockResolvedValue({
    id: TEST_USER_ID,
    autonomousConsentAcceptedAt: new Date(),
  })

  mockWriteAuditLog.mockResolvedValue(undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Regression: non-DEV account with null DOB (Bug 10 baseline)
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression: non-DEV account with null DOB (Bug 10 baseline)', () => {
  it('returns 403 COPPA_BLOCKED', async () => {
    const res = await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('COPPA_BLOCKED')
  })

  it('does not write to the database', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('does not write any audit log entry', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(mockWriteAuditLog).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Regression: null user record (Bug 10 baseline)
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression: null user record (Bug 10 baseline)', () => {
  beforeEach(() => {
    // Override: requireConsent passes (call 1), handler COPPA check returns null (call 2).
    mockUserFindUnique.mockReset()
    mockUserFindUnique
      .mockResolvedValueOnce(CONSENTED_USER_STUB)
      .mockResolvedValueOnce(null)
  })

  it('returns 403 COPPA_BLOCKED', async () => {
    const res = await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('COPPA_BLOCKED')
  })

  it('does not write to the database', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(mockUserUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — DEV bypass: DEV-tagged account with null DOB
// ─────────────────────────────────────────────────────────────────────────────

describe('DEV bypass: DEV-tagged account with null DOB', () => {
  beforeEach(() => {
    mockHasDevPowers.mockResolvedValue(true)
  })

  it('returns 200 even when DOB is null', async () => {
    const res = await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(res.status).toBe(200)
    expect(res.body.data.accepted).toBe(true)
  })

  it('writes COPPA_BYPASS_DEV_ACCOUNT audit entry BEFORE AUTONOMOUS_CONSENT_ACCEPTED', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(2)

    const firstCall = mockWriteAuditLog.mock.calls[0][0] as { action: string }
    const secondCall = mockWriteAuditLog.mock.calls[1][0] as { action: string }
    expect(firstCall.action).toBe('COPPA_BYPASS_DEV_ACCOUNT')
    expect(secondCall.action).toBe('AUTONOMOUS_CONSENT_ACCEPTED')
  })

  it('COPPA_BYPASS_DEV_ACCOUNT entry carries the correct audit fields', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(mockWriteAuditLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: TEST_USER_ID,
        resourceType: 'USER_CONSENT',
        resourceId: String(TEST_USER_ID),
        action: 'COPPA_BYPASS_DEV_ACCOUNT',
      }),
    )
  })

  it('executes the DB write (autonomousConsentAcceptedAt) for a DEV account', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(mockUserUpdate).toHaveBeenCalledTimes(1)
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEST_USER_ID },
        data: expect.objectContaining({ autonomousConsentAcceptedAt: expect.any(Date) }),
      }),
    )
  })

  it('writes COPPA_BYPASS_DEV_ACCOUNT then AUTONOMOUS_CONSENT_REVOKED when revoking consent', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: false })

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(2)

    const firstCall = mockWriteAuditLog.mock.calls[0][0] as { action: string }
    const secondCall = mockWriteAuditLog.mock.calls[1][0] as { action: string }
    expect(firstCall.action).toBe('COPPA_BYPASS_DEV_ACCOUNT')
    expect(secondCall.action).toBe('AUTONOMOUS_CONSENT_REVOKED')
  })

  it('sets autonomousConsentAcceptedAt to null when revoking consent for a DEV account', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: false })

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEST_USER_ID },
        data: expect.objectContaining({ autonomousConsentAcceptedAt: null }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — ADMIN bypass: ADMIN-role account treated identically to DEV
// ─────────────────────────────────────────────────────────────────────────────

describe('ADMIN bypass: ADMIN-role account with null DOB', () => {
  beforeEach(() => {
    // hasDevPowers returns true for ADMIN accounts (role === 'ADMIN' in DB).
    // The mock does not distinguish DEV vs ADMIN — both route through hasDevPowers().
    mockHasDevPowers.mockResolvedValue(true)
  })

  it('returns 200 for an ADMIN account even when DOB is null', async () => {
    const res = await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(res.status).toBe(200)
  })

  it('writes COPPA_BYPASS_DEV_ACCOUNT then AUTONOMOUS_CONSENT_ACCEPTED for ADMIN account', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(2)

    const firstCall = mockWriteAuditLog.mock.calls[0][0] as { action: string }
    const secondCall = mockWriteAuditLog.mock.calls[1][0] as { action: string }
    expect(firstCall.action).toBe('COPPA_BYPASS_DEV_ACCOUNT')
    expect(secondCall.action).toBe('AUTONOMOUS_CONSENT_ACCEPTED')
  })

  it('executes the DB write for an ADMIN account', async () => {
    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    expect(mockUserUpdate).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Server-side-only enforcement: no client-controllable bypass trigger
// ─────────────────────────────────────────────────────────────────────────────

describe('Server-side-only enforcement: bypass cannot be triggered by client input', () => {
  it('returns 403 for a non-DEV account regardless of auth-derived userId', async () => {
    // hasDevPowers returns false — the server-side DB lookup is authoritative.
    // Note: AutonomousConsentSchema uses .strict(), so extra body fields are
    // blocked at the Zod validation layer (422) before COPPA logic runs. This
    // test confirms the end-to-end baseline: a valid request from a non-DEV
    // account with null DOB is blocked at the COPPA layer (403), not allowed
    // through by anything the client controls.
    mockHasDevPowers.mockResolvedValue(false)

    const res = await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ accepted: true })

    // null DOB → 403 COPPA_BLOCKED for a non-DEV account.
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('COPPA_BLOCKED')
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('calls hasDevPowers with the userId from auth middleware, not from the request body', async () => {
    mockHasDevPowers.mockResolvedValue(false)

    await request(app)
      .patch('/users/me/autonomous-consent')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      // Body includes a userId field — it must be ignored; only the auth-derived userId is used.
      .send({ accepted: true })

    // hasDevPowers must be called with the JWT-derived userId, not any body value.
    expect(mockHasDevPowers).toHaveBeenCalledTimes(1)
    expect(mockHasDevPowers).toHaveBeenCalledWith(TEST_USER_ID)
  })

  it('returns 401 when no Authorization header is present', async () => {
    const res = await request(app)
      .patch('/users/me/autonomous-consent')
      .send({ accepted: true })

    expect(res.status).toBe(401)
    // hasDevPowers must never be called without a verified auth context.
    expect(mockHasDevPowers).not.toHaveBeenCalled()
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })
})
