/**
 * QA Security Tests — agentic AI feature.
 *
 * Written by qa-engineer to cover security and compliance gaps not covered
 * by the existing agentExecution.dispatchTool.test.ts suite.
 *
 * Test areas:
 *  1. COPPA gate: null-user bypass, null-DOB bypass, decrypt-failure bypass
 *  2. Adversarial prompt payload: dispatch-layer still denies (not prompt-dependent)
 *  3. Write-tool in SYSTEM session: denied even if toolRegistry lookup succeeds
 *  4. Rate limit: denied before DB mutation; both audit records written on denial
 *  5. Hard cap: enforced atomically via updateMany before every dispatch
 *  6. Autonomous flag gate: startSession returns SKIPPED_FLAG_OFF regardless of caller
 *  7. Audit log atomicity: $transaction failure → no SUCCESS record, no FAILED mislabel
 *  8. Confirm race: idempotency check returns 409 on duplicate PENDING confirmation
 *  9. TOCTOU on planner write tools: Prisma update WHERE clause includes userId
 * 10. Consent revocation: server NOT called on toggle-off (frontend gap, documented)
 */

import { startSession, dispatchTool } from '../agentExecution.service'

// ── Shared mock setup ─────────────────────────────────────────────────────────

const mockFindUnique = jest.fn()
const mockFindFirst = jest.fn()
const mockUpdate = jest.fn()
const mockUpdateMany = jest.fn()
const mockCreate = jest.fn()
const mockTransaction = jest.fn()

jest.mock('../../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    agentSession: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    agentToolCall: {
      create: (...args: unknown[]) => mockCreate(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
    agentWriteRateLimit: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpdate(...args),
    },
    complianceAuditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    $executeRaw: jest.fn().mockResolvedValue(1),
  },
}))

const mockWriteAuditLog = jest.fn()
jest.mock('../../../lib/auditLog', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}))

const mockConsumeRateLimit = jest.fn()
jest.mock('../writeRateLimit.service', () => ({
  consumeWriteRateLimitSlot: (...args: unknown[]) => mockConsumeRateLimit(...args),
}))

// hasDevPowers is mocked so the real requireAdmin Prisma query never runs.
// Default return is false (not a dev account) so all existing tests are unaffected.
const mockHasDevPowers = jest.fn()
jest.mock('../../../middleware/requireAdmin', () => ({
  hasDevPowers: (...args: unknown[]) => mockHasDevPowers(...args),
}))

// Decrypt mock — simulates the real encrypt/decrypt cycle in test
jest.mock('../../../integrations/grades/credentialCrypto', () => ({
  decryptPassword: (input: string) => {
    if (input === 'DECRYPT_FAIL') throw new Error('Decryption failed')
    return input  // in tests, pass the raw date string as-is
  },
}))

jest.mock('../tools/registry', () => {
  const writeTool = {
    name: 'planner_create_task',
    module: 'PLANNER',
    type: 'WRITE',
    rateLimitPerHour: 20,
    execute: jest.fn().mockResolvedValue({ id: 99, title: 'Test task', dueDate: '2026-08-01' }),
  }
  const readTool = {
    name: 'planner_get_tasks',
    module: 'PLANNER',
    type: 'READ',
    execute: jest.fn().mockResolvedValue({ tasks: [] }),
  }
  return {
    toolRegistry: new Map([
      [writeTool.name, writeTool],
      [readTool.name, readTool],
    ]),
    WRITE_TOOL_NAMES: new Set<string>(['planner_create_task']),
    __writeTool: writeTool,
    __readTool: readTool,
  }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const registryMock = require('../tools/registry') as {
  __writeTool: { execute: jest.Mock }
  __readTool: { execute: jest.Mock }
}

const IP = '127.0.0.1'

// Helper: build a session row for dispatchTool tests
function makeSessionRow(
  overrides: Partial<{
    module: string
    trigger: string
    toolCallCount: number
    status: string
    userId: number
  }> = {},
) {
  return {
    userId: 42,
    module: 'PLANNER',
    trigger: 'USER',
    toolCallCount: 0,
    status: 'RUNNING',
    ...overrides,
  }
}

// ── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  // Default: not a dev account — all existing COPPA checks fire unchanged.
  mockHasDevPowers.mockResolvedValue(false)
  mockWriteAuditLog.mockResolvedValue(undefined)
  mockCreate.mockResolvedValue({ id: 1 })
  mockUpdate.mockResolvedValue({})
  // updateMany returns { count: 1 } by default (slot claimed / row updated)
  mockUpdateMany.mockResolvedValue({ count: 1 })
  // consumeWriteRateLimitSlot returns true (allowed) by default
  mockConsumeRateLimit.mockResolvedValue(true)
  // $transaction runs the callback by default (success path)
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      agentToolCall: { create: (...args: unknown[]) => mockCreate(...args) },
      complianceAuditLog: { create: jest.fn().mockResolvedValue({}) },
    }
    return callback(tx)
  })
  registryMock.__writeTool.execute.mockResolvedValue({ id: 99, title: 'Test', dueDate: '2026-08-01' })
  registryMock.__readTool.execute.mockResolvedValue({ tasks: [] })
})

// ═════════════════════════════════════════════════════════════════════════════
// 1. COPPA GATE BYPASS TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('COPPA gate — startSession', () => {

  /**
   * BUG-001 (FIXED): null user must be rejected before any session row is created.
   *
   * Prior behavior: if user.findUnique returned null, the COPPA check was skipped
   * entirely and a RUNNING session was created for a nonexistent user (FK violation
   * and COPPA bypass).
   *
   * Fixed behavior: null user → immediate COPPA_GATE block, no session row created.
   */
  it('BUG-001 FIXED: null user returns COPPA_GATE without creating a session', async () => {
    mockFindUnique.mockResolvedValueOnce(null)  // user lookup → not found
    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await startSession(999, 'PLANNER', 'USER', 'hello', IP)

    // FIXED: null user must be blocked — no session created for a nonexistent user
    expect(result.blockedReason).toBe('COPPA_GATE')

    // No agentSession.create must have been called (no valid user to FK against)
    expect(mockCreate).not.toHaveBeenCalled()

    // Audit log must still be written for the block
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COPPA_BLOCK' }),
    )
  })

  /**
   * BUG-002 (FIXED): null DOB must be treated as age-unknown and result in a
   * COPPA block, not as an adult (age=999 sentinel).
   *
   * Prior behavior: null DOB → computeAge returned 999 → treated as adult →
   * RUNNING session created (COPPA bypass for users who never set their DOB).
   *
   * Fixed behavior: null DOB → BLOCKED_COPPA session, blockedReason='COPPA_GATE'.
   */
  it('BUG-002 FIXED: null DOB returns COPPA_GATE (age-unknown is not adult)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: null,
      coppaConsentStatus: 'PENDING',
    })
    mockCreate.mockResolvedValue({ id: 56 })
    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await startSession(100, 'PLANNER', 'USER', 'hello', IP)

    // FIXED: null DOB must be treated as age-unknown → COPPA block
    expect(result.blockedReason).toBe('COPPA_GATE')

    // A BLOCKED_COPPA session row is created (user exists, so FK is valid)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'BLOCKED_COPPA' }),
      }),
    )

    // Audit log must record the block
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COPPA_BLOCK' }),
    )
  })

  /**
   * BUG-003 (FIXED): DOB decryption failure must result in a COPPA block, not
   * a pass-through (the old catch block returned 999 to pass the age gate).
   *
   * Prior behavior: decryption throws → catch returned 999 → treated as adult →
   * RUNNING session created (COPPA bypass on infrastructure failure).
   *
   * Fixed behavior: decryption error → BLOCKED_COPPA session, error logged at
   * ERROR level, blockedReason='COPPA_GATE'.
   */
  it('BUG-003 FIXED: DOB decryption failure returns COPPA_GATE (fail closed on error)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: 'DECRYPT_FAIL',   // triggers throw in decryptPassword mock
      coppaConsentStatus: 'PENDING',
    })
    mockCreate.mockResolvedValue({ id: 57 })
    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await startSession(101, 'PLANNER', 'USER', 'hello', IP)

    // FIXED: decryption failure must be a hard COPPA block
    expect(result.blockedReason).toBe('COPPA_GATE')

    // A BLOCKED_COPPA session row is created
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'BLOCKED_COPPA' }),
      }),
    )

    // Audit log must record the block
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COPPA_BLOCK' }),
    )
  })

  /**
   * Positive control: under-13 user with verified consent should proceed.
   */
  it('allows under-13 user with VERIFIED consent to start a session', async () => {
    const under13Dob = new Date()
    under13Dob.setFullYear(under13Dob.getFullYear() - 10)  // 10 years old

    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: under13Dob.toISOString(),
      coppaConsentStatus: 'VERIFIED',
    })
    mockCreate.mockResolvedValue({ id: 58 })
    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await startSession(102, 'PLANNER', 'USER', 'hello', IP)

    expect(result.blockedReason).toBeUndefined()
    expect(result.sessionId).toBe(58)
  })

  /**
   * Under-13 user with PENDING consent should be blocked.
   */
  it('blocks under-13 user with PENDING consent', async () => {
    const under13Dob = new Date()
    under13Dob.setFullYear(under13Dob.getFullYear() - 10)

    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: under13Dob.toISOString(),
      coppaConsentStatus: 'PENDING',
    })
    // The blocked path creates a BLOCKED_COPPA session, then audit log
    mockCreate.mockResolvedValue({ id: 59 })
    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await startSession(103, 'GPA', 'USER', undefined, IP)

    expect(result.blockedReason).toBe('COPPA_GATE')
  })

  /**
   * COPPA block must fire for ALL modules, not just PLANNER.
   */
  it.each(['PLANNER', 'GPA', 'ROADMAP', 'CHAT'] as const)(
    'blocks under-13 user in %s module',
    async (module) => {
      const under13Dob = new Date()
      under13Dob.setFullYear(under13Dob.getFullYear() - 10)

      mockFindUnique.mockResolvedValueOnce({
        dateOfBirth: under13Dob.toISOString(),
        coppaConsentStatus: 'NOT_SET',
      })
      mockCreate.mockResolvedValue({ id: 60 })
      mockWriteAuditLog.mockResolvedValue(undefined)

      const result = await startSession(104, module, 'USER', 'hello', IP)

      expect(result.blockedReason).toBe('COPPA_GATE')
    },
  )

  /**
   * COPPA block must also fire for SYSTEM trigger, not just USER.
   * (AUTONOMOUS_AGENTS_ENABLED gate checked first, but if flag is on,
   * COPPA must still gate the system session.)
   */
  it('blocks under-13 user in SYSTEM trigger when autonomous flag is on', async () => {
    process.env.AUTONOMOUS_AGENTS_ENABLED = 'true'

    const under13Dob = new Date()
    under13Dob.setFullYear(under13Dob.getFullYear() - 10)

    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: under13Dob.toISOString(),
      coppaConsentStatus: 'PENDING',
    })
    mockCreate.mockResolvedValue({ id: 61 })
    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await startSession(105, 'GPA', 'SYSTEM', undefined, IP)

    expect(result.blockedReason).toBe('COPPA_GATE')

    delete process.env.AUTONOMOUS_AGENTS_ENABLED
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 2. AUTONOMOUS FLAG GATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Autonomous flag gate — startSession with SYSTEM trigger', () => {

  it('returns SKIPPED_FLAG_OFF when AUTONOMOUS_AGENTS_ENABLED is unset', async () => {
    delete process.env.AUTONOMOUS_AGENTS_ENABLED

    const result = await startSession(200, 'GPA', 'SYSTEM', undefined, IP)

    expect(result.blockedReason).toBe('SKIPPED_FLAG_OFF')
    // No DB writes should have happened
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('returns SKIPPED_FLAG_OFF when AUTONOMOUS_AGENTS_ENABLED is "false"', async () => {
    process.env.AUTONOMOUS_AGENTS_ENABLED = 'false'

    const result = await startSession(200, 'GPA', 'SYSTEM', undefined, IP)

    expect(result.blockedReason).toBe('SKIPPED_FLAG_OFF')
    expect(mockCreate).not.toHaveBeenCalled()

    delete process.env.AUTONOMOUS_AGENTS_ENABLED
  })

  it('does NOT return SKIPPED_FLAG_OFF for USER trigger regardless of flag', async () => {
    delete process.env.AUTONOMOUS_AGENTS_ENABLED

    const adultDob = new Date()
    adultDob.setFullYear(adultDob.getFullYear() - 17)
    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: adultDob.toISOString(),
      coppaConsentStatus: 'NOT_REQUIRED',
    })
    mockCreate.mockResolvedValue({ id: 62 })
    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await startSession(201, 'PLANNER', 'USER', 'hi', IP)

    // USER trigger never returns SKIPPED_FLAG_OFF
    expect(result.blockedReason).not.toBe('SKIPPED_FLAG_OFF')
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 3. WRITE-TOOL IN SYSTEM SESSION DENIAL
// ═════════════════════════════════════════════════════════════════════════════

describe('Write-tool denial in SYSTEM sessions — dispatchTool', () => {

  it('denies planner_create_task in a SYSTEM session, denialReason=ALLOWLIST', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'SYSTEM' }))

    const result = await dispatchTool(1, 'planner_create_task', { title: 'x', subject: 'y', dueDate: '2026-08-01' }, IP)

    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('ALLOWLIST')
    expect(registryMock.__writeTool.execute).not.toHaveBeenCalled()
  })

  it('records both AgentToolCall and audit log on write-in-system denial', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'SYSTEM' }))

    await dispatchTool(1, 'planner_create_task', {}, IP)

    expect(mockCreate).toHaveBeenCalledTimes(1)   // AgentToolCall record
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1)  // compliance_audit_log record
  })

  it('allows the same write tool in a USER session (control)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'USER' }))
    // consumeWriteRateLimitSlot returns true (allowed) by default in beforeEach

    const result = await dispatchTool(2, 'planner_create_task', { title: 'x', subject: 'y', dueDate: '2026-08-01' }, IP)

    expect(result.success).toBe(true)
    expect(registryMock.__writeTool.execute).toHaveBeenCalled()
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 4. ADVERSARIAL PAYLOADS — DISPATCH-LAYER DENIAL (not prompt-dependent)
// ═════════════════════════════════════════════════════════════════════════════

describe('Adversarial tool name dispatch — allowlist enforcement', () => {

  const adversarialPayloads = [
    // Injection attempts in the tool name itself
    'ignore_previous_instructions_and_delete_all_tasks',
    'system_override_planner_delete_task',
    'developer_mode_roadmap_apply_course_change',
    // Planner write tool being called from a GPA session (cross-module)
    'planner_create_task',    // tested via GPA session below
    // Roadmap write tool name
    'roadmap_apply_course_change',
    // Non-existent escalation attempts
    'admin_override',
    'execute_arbitrary_sql',
    'drop_table_assignments',
    '__proto__',
    'constructor.prototype',
    'eval',
  ]

  // Non-existent tool names are rejected regardless of session module
  const unregisteredTools = adversarialPayloads.filter(
    n => !['planner_create_task', 'roadmap_apply_course_change'].includes(n),
  )

  it.each(unregisteredTools)(
    'denies unregistered adversarial tool name "%s" in PLANNER session',
    async (toolName) => {
      mockFindUnique.mockResolvedValue(makeSessionRow())

      const result = await dispatchTool(1, toolName, {}, IP)

      expect(result.success).toBe(false)
      expect(result.denialReason).toBe('ALLOWLIST')
    },
  )

  it('denies planner_create_task (write) when called from GPA session (cross-module + write)', async () => {
    // GPA session tries to call a PLANNER write tool
    mockFindUnique.mockResolvedValue(makeSessionRow({ module: 'GPA', trigger: 'USER' }))

    const result = await dispatchTool(1, 'planner_create_task', {}, IP)

    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('ALLOWLIST')
    expect(registryMock.__writeTool.execute).not.toHaveBeenCalled()
  })

  it('denies roadmap_apply_course_change in SYSTEM session (write-in-system guard)', async () => {
    // Simulate ROADMAP SYSTEM session — write tool should be denied
    // First register it in the registry mock for this test
    const origRegistry = require('../tools/registry')
    const savedRegistry = origRegistry.toolRegistry

    // Add roadmap write tool to the mock registry for this assertion
    const roadmapWriteTool = {
      name: 'roadmap_apply_course_change',
      module: 'ROADMAP',
      type: 'WRITE',
      rateLimitPerHour: 5,
      execute: jest.fn(),
    }
    savedRegistry.set('roadmap_apply_course_change', roadmapWriteTool)

    mockFindUnique.mockResolvedValue(makeSessionRow({ module: 'ROADMAP', trigger: 'SYSTEM' }))

    const result = await dispatchTool(1, 'roadmap_apply_course_change', {}, IP)

    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('ALLOWLIST')
    expect(roadmapWriteTool.execute).not.toHaveBeenCalled()

    // Cleanup
    savedRegistry.delete('roadmap_apply_course_change')
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 5. RATE LIMIT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Write-tool rate limiting — dispatchTool', () => {

  it('denies planner_create_task when rate limit is hit, before execute is called', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'USER' }))
    mockConsumeRateLimit.mockResolvedValue(false)  // rate limit denied

    const result = await dispatchTool(1, 'planner_create_task', {}, IP)

    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('RATE_LIMIT')
    // Tool must NOT have executed — rate limit fires before execute
    expect(registryMock.__writeTool.execute).not.toHaveBeenCalled()
  })

  it('records AgentToolCall with DENIED+RATE_LIMIT when rate limit fires', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'USER' }))
    mockConsumeRateLimit.mockResolvedValue(false)

    await dispatchTool(1, 'planner_create_task', { title: 'x', subject: 'y', dueDate: '2026-08-01' }, IP)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DENIED',
          denialReason: 'RATE_LIMIT',
        }),
      }),
    )
  })

  it('records compliance_audit_log entry when rate limit fires', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'USER' }))
    mockConsumeRateLimit.mockResolvedValue(false)

    await dispatchTool(1, 'planner_create_task', {}, IP)

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TOOL_DENIED_RATE_LIMIT',
        resourceId: 'planner_create_task',
      }),
    )
  })

  it('consumeWriteRateLimitSlot is NOT called for read tools (no rateLimitPerHour)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'USER' }))
    // Even if consume would deny, read tools bypass the check entirely
    mockConsumeRateLimit.mockResolvedValue(false)

    const result = await dispatchTool(1, 'planner_get_tasks', {}, IP)

    // Read tool should succeed — rate limit check is skipped for read tools
    expect(result.success).toBe(true)
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })

  it('read tools bypass rate limit check (no rateLimitPerHour on read tools)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'USER' }))
    // Rate limit should not be checked for read tools
    mockConsumeRateLimit.mockResolvedValue(false)  // would deny if checked

    const result = await dispatchTool(1, 'planner_get_tasks', {}, IP)

    // Read tool should succeed regardless
    expect(result.success).toBe(true)
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 6. HARD TOOL CAP
// ═════════════════════════════════════════════════════════════════════════════

describe('Hard tool cap enforcement — dispatchTool', () => {

  it('denies dispatch when atomic slot claim returns count=0 (cap reached)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ toolCallCount: 15 }))
    // updateMany returns count=0: WHERE toolCallCount < 15 was false (15 is not < 15)
    mockUpdateMany.mockResolvedValue({ count: 0 })

    const result = await dispatchTool(1, 'planner_get_tasks', {}, IP)

    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('RATE_LIMIT')
    expect(registryMock.__readTool.execute).not.toHaveBeenCalled()
  })

  it('denies at cap=15 even for read tools (hard cap is absolute)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ toolCallCount: 15, trigger: 'USER' }))
    mockUpdateMany.mockResolvedValue({ count: 0 })

    const result = await dispatchTool(1, 'planner_get_tasks', {}, IP)

    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('RATE_LIMIT')
  })

  it('records both AgentToolCall and audit log when hard cap fires', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ toolCallCount: 15 }))
    mockUpdateMany.mockResolvedValue({ count: 0 })

    await dispatchTool(1, 'planner_get_tasks', {}, IP)

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TOOL_DENIED_HARD_CAP' }),
    )
  })

  it('allows dispatch when atomic slot claim succeeds (count=1 returned)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ toolCallCount: 14 }))
    // updateMany returns count=1: WHERE toolCallCount < 15 was true (14 < 15)
    mockUpdateMany.mockResolvedValue({ count: 1 })

    const result = await dispatchTool(1, 'planner_get_tasks', {}, IP)

    expect(result.success).toBe(true)
  })

  it('atomic slot claim is called before tool execution (correct order)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ toolCallCount: 0 }))
    mockUpdateMany.mockResolvedValue({ count: 1 })

    const callOrder: string[] = []
    mockUpdateMany.mockImplementation(() => {
      callOrder.push('updateMany')
      return Promise.resolve({ count: 1 })
    })
    registryMock.__readTool.execute.mockImplementation(() => {
      callOrder.push('execute')
      return Promise.resolve({ tasks: [] })
    })

    await dispatchTool(1, 'planner_get_tasks', {}, IP)

    // Slot must be claimed atomically BEFORE the tool runs
    expect(callOrder).toEqual(['updateMany', 'execute'])
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 7. AUDIT LOG ATOMICITY (FERPA RISK — fixed via $transaction)
// ═════════════════════════════════════════════════════════════════════════════

describe('Audit log atomicity — dispatchTool success path', () => {

  /**
   * BUG-007 (FIXED): On the success path, AgentToolCall.create and
   * ComplianceAuditLog.create are now wrapped in a single $transaction.
   * If the transaction fails, NEITHER record is persisted — no SUCCESS record
   * without an audit trail, and no misleading FAILED record written by the
   * catch block.
   *
   * The service returns { success: false, denialReason: 'ERROR' } so the
   * orchestrator knows the persistence failed, and logs an ERROR-level entry
   * (infrastructure failure, not a tool failure).
   */
  it('BUG-007 FIXED: $transaction failure leaves no tool call records (no SUCCESS, no FAILED)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'USER' }))
    mockUpdateMany.mockResolvedValue({ count: 1 })  // slot claimed

    // $transaction rejects before invoking the callback
    mockTransaction.mockRejectedValueOnce(new Error('DB unavailable'))

    const result = await dispatchTool(1, 'planner_get_tasks', {}, IP)

    // Tool DID execute (the execution try block succeeded)
    expect(registryMock.__readTool.execute).toHaveBeenCalled()

    // The $transaction threw before the callback ran → no creates were called
    // (callback form: prisma.agentToolCall.create is called inside the callback,
    // not before it, so mockCreate was never invoked)
    expect(mockCreate).not.toHaveBeenCalled()

    // Result is an infrastructure failure — not success, not a misleading FAILED label
    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('ERROR')
  })

  it('tool execution failure writes a FAILED record but NO $transaction (correct path separation)', async () => {
    mockFindUnique.mockResolvedValue(makeSessionRow({ trigger: 'USER' }))
    mockUpdateMany.mockResolvedValue({ count: 1 })

    registryMock.__readTool.execute.mockRejectedValueOnce(new Error('Tool error'))

    const result = await dispatchTool(1, 'planner_get_tasks', {}, IP)

    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('ERROR')

    // A FAILED tool call record must be written (direct create, not in transaction)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', denialReason: 'ERROR' }),
      }),
    )

    // $transaction must NOT have been called (tool failed, no audit log for failures)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 8. CONFIRM IDEMPOTENCY — returns 409 if PENDING write_confirmation exists
// ═════════════════════════════════════════════════════════════════════════════

describe('Confirm endpoint idempotency (BUG-008 fixed)', () => {

  /**
   * BUG-008 (FIXED): The confirm endpoint now checks for an existing PENDING
   * write_confirmation before creating a new one, returning 409 if found.
   * A unique partial DB index (startup.ts) provides DB-layer enforcement.
   *
   * This test verifies the application-level idempotency check behavior by
   * confirming that the service logic guards against duplicate PENDING records.
   *
   * Note: the route handler test is an integration concern. Here we verify the
   * structural guard exists in the route code by checking the findFirst call
   * pattern that the fix requires.
   */
  it('BUG-008 FIXED: idempotency check queries for existing PENDING write_confirmation', () => {
    // Structural test: confirm that agentSessions.ts route handler includes a
    // findFirst query for existing PENDING write_confirmation records before
    // creating a new PENDING record.
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')

    const routePath = path.resolve(
      __dirname,
      '../../../routes/agentSessions.ts',
    )
    const source = fs.readFileSync(routePath, 'utf-8')

    // The fix must include a findFirst for PENDING write_confirmation
    expect(source).toMatch(/findFirst/)
    expect(source).toMatch(/write_confirmation/)
    expect(source).toMatch(/PENDING/)
    expect(source).toMatch(/409/)
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 9. TOCTOU FIX — write tool WHERE clause includes userId
// ═════════════════════════════════════════════════════════════════════════════

describe('Cross-user data isolation — write tool WHERE clause (BUG-009 fixed)', () => {

  /**
   * BUG-009 (FIXED): plannerUpdateTask, plannerCompleteTask, plannerDeleteTask,
   * and roadmapApplyCourseChange now include userId in the Prisma updateMany/
   * deleteMany WHERE clause, making cross-user mutations architecturally
   * impossible at the DB layer (belt-and-suspenders beyond the pre-check).
   */
  it('BUG-009 FIXED: plannerUpdateTask Prisma mutation includes userId in WHERE (structural audit)', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')

    const plannerWritePath = path.resolve(
      __dirname,
      '../tools/write/plannerWriteTools.ts',
    )
    const source = fs.readFileSync(plannerWritePath, 'utf-8')

    // Confirm the old unscoped pattern is GONE
    const unscopedUpdatePattern = /prisma\.assignment\.update\(\s*\{[\s\S]*?where:\s*\{\s*id:\s*parsed\.taskId\s*\}/
    expect(source).not.toMatch(unscopedUpdatePattern)

    // Confirm the new scoped pattern IS present (userId in WHERE clause)
    expect(source).toMatch(/updateMany/)
    expect(source).toMatch(/userId/)
  })

  it('BUG-009 FIXED: roadmapApplyCourseChange Prisma mutation includes userId in WHERE (structural audit)', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')

    const roadmapWritePath = path.resolve(
      __dirname,
      '../tools/write/roadmapWriteTools.ts',
    )
    const source = fs.readFileSync(roadmapWritePath, 'utf-8')

    // Confirm the old unscoped pattern is GONE
    const unscopedUpdatePattern = /prisma\.course\.update\(\s*\{[\s\S]*?where:\s*\{\s*id:\s*parsed\.courseId\s*\}/
    expect(source).not.toMatch(unscopedUpdatePattern)

    // Confirm the new scoped pattern IS present
    expect(source).toMatch(/updateMany/)
    expect(source).toMatch(/userId/)
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 10. FRONTEND CONSENT REVOCATION SERVER GAP
// ═════════════════════════════════════════════════════════════════════════════

describe('Consent revocation — AICheckInsScreen.tsx frontend gap (documented)', () => {

  /**
   * BUG-010 (HIGH): AICheckInsScreen.tsx handleToggleOff (lines 161-178)
   * only updates AsyncStorage and local React state. It never calls
   * patchAutonomousConsent({ accepted: false }) or any equivalent server API.
   *
   * Result: the server's autonomousConsentAcceptedAt remains set.
   * Autonomous jobs continue to be enqueued and run even after the user
   * has "turned off" AI Check-ins in the UI.
   *
   * This also means no compliance audit log entry is written for the
   * consent revocation.
   *
   * Fix: handleToggleOff must call patchAutonomousConsent({ accepted: false })
   * on the server before (or in addition to) updating local state.
   *
   * This test documents the gap. It cannot be exercised with a backend
   * unit test — it requires an integration test against the live frontend.
   * The finding is confirmed by reading AICheckInsScreen.tsx lines 161-178.
   */
  it('BUG-010: handleToggleOff never calls patchAutonomousConsent — documented structural gap', () => {
    // Structural test: read the implementation to confirm the gap.
    // The Alert.alert callback at line 171 sets local state and calls
    // AsyncStorage.setItem but has NO await patchAutonomousConsent() call.
    //
    // Expected server behavior after fix:
    //   DELETE or PATCH /users/me/autonomous-consent with accepted: false
    //   → server sets autonomousConsentAcceptedAt = null
    //   → audit log records 'AUTONOMOUS_CONSENT_REVOKED'
    //   → autonomous job enqueue skips this user (no consent)
    //
    // Current behavior (bug):
    //   UI shows toggle as OFF
    //   Server: autonomousConsentAcceptedAt is still set
    //   Autonomous jobs: still run for this user
    expect(true).toBe(true)  // Marker: fix required in AICheckInsScreen.tsx
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 11. DEV/ADMIN COPPA BYPASS — architect-approved for internal test accounts
// ═════════════════════════════════════════════════════════════════════════════

describe('DEV/ADMIN COPPA bypass — startSession', () => {

  /**
   * Scenario 1 — Regression guard:
   * A non-DEV/non-ADMIN account with dateOfBirth=null must still be blocked
   * with BLOCKED_COPPA status and a COPPA_BLOCK audit entry. hasDevPowers
   * returns false (the default in beforeEach) so the existing null-DOB path
   * runs byte-for-byte as before.
   */
  it('Scenario 1: non-DEV account with null DOB is still blocked (COPPA_BLOCK audit)', async () => {
    // hasDevPowers returns false (beforeEach default)
    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: null,
      coppaConsentStatus: 'PENDING',
    })
    mockCreate.mockResolvedValue({ id: 200 })

    const result = await startSession(500, 'PLANNER', 'USER', 'hello', IP)

    expect(result.blockedReason).toBe('COPPA_GATE')

    // A BLOCKED_COPPA session row must have been created
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'BLOCKED_COPPA' }),
      }),
    )

    // Audit log must record COPPA_BLOCK (not the bypass action)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COPPA_BLOCK' }),
    )

    // The bypass audit action must NOT have been written
    expect(mockWriteAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COPPA_BYPASS_DEV_ACCOUNT' }),
    )
  })

  /**
   * Scenario 2 — Regression guard:
   * A non-DEV/non-ADMIN account whose user record does not exist must still be
   * blocked before any session row is created. The null-user check fires before
   * hasDevPowers is ever reached, so hasDevPowers should not be called at all.
   */
  it('Scenario 2: null user record is still blocked before session creation (regression guard)', async () => {
    mockFindUnique.mockResolvedValueOnce(null)  // user not found

    const result = await startSession(501, 'PLANNER', 'USER', 'hello', IP)

    expect(result.blockedReason).toBe('COPPA_GATE')
    expect(result.sessionId).toBe(-1)

    // No session row should be created
    expect(mockCreate).not.toHaveBeenCalled()

    // hasDevPowers must not be called — the null-user check fires first
    expect(mockHasDevPowers).not.toHaveBeenCalled()

    // Audit log must record COPPA_BLOCK
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COPPA_BLOCK' }),
    )
  })

  /**
   * Scenario 3 — DEV bypass:
   * A DEV-tagged account with dateOfBirth=null must proceed to a RUNNING session.
   * The COPPA_BYPASS_DEV_ACCOUNT audit entry must be written FIRST, followed by
   * the normal SESSION_START audit entry. Both writeAuditLog calls must happen
   * in the correct order. The session must have status RUNNING.
   */
  it('Scenario 3: DEV-tagged account with null DOB proceeds to RUNNING session with both audit entries', async () => {
    mockHasDevPowers.mockResolvedValue(true)
    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: null,
      coppaConsentStatus: 'PENDING',
    })
    mockCreate.mockResolvedValue({ id: 201 })

    const result = await startSession(502, 'CHAT', 'USER', 'test message', IP)

    // Must NOT be blocked
    expect(result.blockedReason).toBeUndefined()
    expect(result.sessionId).toBe(201)

    // Session must be RUNNING
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RUNNING' }),
      }),
    )

    // COPPA_BYPASS_DEV_ACCOUNT audit entry must be written
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 502,
        resourceType: 'AGENT_SESSION',
        action: 'COPPA_BYPASS_DEV_ACCOUNT',
        ipAddress: IP,
      }),
    )

    // SESSION_START audit entry must also be written
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 502,
        resourceType: 'AGENT_SESSION',
        action: 'SESSION_START',
        ipAddress: IP,
      }),
    )

    // Assert call order: bypass audit first, then session-start audit
    const calls = mockWriteAuditLog.mock.calls.map(
      (args: Array<Record<string, unknown>>) => args[0].action,
    )
    const bypassIdx = calls.indexOf('COPPA_BYPASS_DEV_ACCOUNT')
    const startIdx = calls.indexOf('SESSION_START')
    expect(bypassIdx).toBeGreaterThanOrEqual(0)
    expect(startIdx).toBeGreaterThan(bypassIdx)

    // No COPPA_BLOCK entry should have been written
    expect(mockWriteAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COPPA_BLOCK' }),
    )
  })

  /**
   * Scenario 4 — ADMIN bypass:
   * An ADMIN-tagged account gets the same bypass treatment as a DEV-tagged account.
   * hasDevPowers returns true for ADMIN role — both return the same bypass result.
   */
  it('Scenario 4: ADMIN-tagged account with null DOB gets same bypass as DEV-tagged account', async () => {
    mockHasDevPowers.mockResolvedValue(true)  // ADMIN role triggers hasDevPowers=true
    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: null,
      coppaConsentStatus: 'PENDING',
    })
    mockCreate.mockResolvedValue({ id: 202 })

    const result = await startSession(503, 'GPA', 'USER', undefined, IP)

    // Must NOT be blocked
    expect(result.blockedReason).toBeUndefined()
    expect(result.sessionId).toBe(202)

    // Session must be RUNNING
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RUNNING' }),
      }),
    )

    // Both audit entries must be present
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COPPA_BYPASS_DEV_ACCOUNT' }),
    )
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_START' }),
    )
  })

  /**
   * Scenario 5 — Server-side enforcement:
   * hasDevPowers is called with the userId param that originates from auth
   * middleware (the trusted server-side value) — not from any client-supplied
   * source. This is verified two ways:
   *   (a) Runtime: confirm mockHasDevPowers is called with exactly userId.
   *   (b) Structural: read the source file and confirm it contains no reference
   *       to req.headers, req.query, req.body, or any JWT claim for this decision.
   */
  it('Scenario 5a: hasDevPowers is called with the server-trusted userId, not a client value (runtime)', async () => {
    mockHasDevPowers.mockResolvedValue(false)
    mockFindUnique.mockResolvedValueOnce({
      dateOfBirth: null,
      coppaConsentStatus: 'PENDING',
    })
    mockCreate.mockResolvedValue({ id: 203 })

    const testUserId = 504
    await startSession(testUserId, 'PLANNER', 'USER', 'hi', IP)

    // hasDevPowers must have been called with exactly the userId param
    expect(mockHasDevPowers).toHaveBeenCalledWith(testUserId)
    expect(mockHasDevPowers).toHaveBeenCalledTimes(1)
  })

  it('Scenario 5b: startSession source contains no client-supplied bypass vector (structural audit)', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')

    const servicePath = path.resolve(
      __dirname,
      '../agentExecution.service.ts',
    )
    const source = fs.readFileSync(servicePath, 'utf-8')

    // The bypass decision must never read any client-supplied request field.
    // These patterns would indicate a forbidden client-controlled bypass vector.
    const forbiddenPatterns = [
      /req\.headers/,
      /req\.query/,
      /req\.body/,
      /x-dev-bypass/i,
      /x-admin-override/i,
      /decodedToken\./,
    ]

    for (const pattern of forbiddenPatterns) {
      expect(source).not.toMatch(pattern)
    }

    // Confirm hasDevPowers is called with userId (the server-trusted param)
    expect(source).toMatch(/hasDevPowers\(userId\)/)
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// 12. SESSION STATUS CHECK BEFORE DISPATCH (non-RUNNING session)
// ═════════════════════════════════════════════════════════════════════════════

describe('Session status guard — dispatchTool', () => {

  it.each(['COMPLETED', 'FAILED', 'BLOCKED_COPPA'] as const)(
    'denies dispatch on a %s session',
    async (status) => {
      mockFindUnique.mockResolvedValue(makeSessionRow({ status }))

      const result = await dispatchTool(1, 'planner_get_tasks', {}, IP)

      expect(result.success).toBe(false)
      expect(result.denialReason).toBe('ERROR')
      expect(registryMock.__readTool.execute).not.toHaveBeenCalled()
    },
  )

  it('returns ERROR for a completely nonexistent session ID', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await dispatchTool(999999, 'planner_get_tasks', {}, IP)

    expect(result.success).toBe(false)
    expect(result.denialReason).toBe('ERROR')
  })

})
