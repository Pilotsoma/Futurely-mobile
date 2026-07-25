/**
 * Unit tests for AgentExecutionService.dispatchTool — module-scope guardrail.
 *
 * These tests verify that:
 * 1. PLANNER sessions cannot call GPA or ROADMAP tools (cross-module denial).
 * 2. GPA sessions cannot call PLANNER tools (cross-module denial).
 * 3. CHAT sessions CAN call tools registered under any module (exemption).
 * 4. No session (including CHAT) can call an unregistered tool name.
 *
 * All Prisma, auditLog, registry, and rate-limit interactions are mocked so
 * no real database connection is required.
 */

import { dispatchTool } from '../agentExecution.service'

// ── Mock: Prisma ──────────────────────────────────────────────────────────────

const mockFindUnique = jest.fn()
const mockUpdate = jest.fn()
const mockUpdateMany = jest.fn()
const mockCreate = jest.fn()
const mockTransaction = jest.fn()

jest.mock('../../../lib/prisma', () => ({
  prisma: {
    agentSession: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    agentToolCall: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
    complianceAuditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

// ── Mock: audit log ───────────────────────────────────────────────────────────

jest.mock('../../../lib/auditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

// ── Mock: write rate limit ────────────────────────────────────────────────────

jest.mock('../writeRateLimit.service', () => ({
  consumeWriteRateLimitSlot: jest.fn().mockResolvedValue(true),
}))

// ── Mock: tool registry ───────────────────────────────────────────────────────
//
// jest.mock factories are hoisted before any variable declarations, so the
// registry map and tool stubs must be built entirely inside the factory.
// We expose them on the module object so the test body can access them via
// require() after setup.

jest.mock('../tools/registry', () => {
  const plannerTool = {
    name: 'planner_get_tasks',
    module: 'PLANNER',
    type: 'READ',
    execute: jest.fn().mockResolvedValue({ tasks: [] }),
  }
  const gpaTool = {
    name: 'gpa_get_current_gpa',
    module: 'GPA',
    type: 'READ',
    execute: jest.fn().mockResolvedValue({ gpa: 3.5 }),
  }
  const roadmapTool = {
    name: 'roadmap_get_current_plan',
    module: 'ROADMAP',
    type: 'READ',
    execute: jest.fn().mockResolvedValue({ plan: [] }),
  }
  return {
    toolRegistry: new Map([
      [plannerTool.name, plannerTool],
      [gpaTool.name, gpaTool],
      [roadmapTool.name, roadmapTool],
    ]),
    WRITE_TOOL_NAMES: new Set<string>(),
    // Expose the stubs for assertions in test cases
    __plannerTool: plannerTool,
    __gpaTool: gpaTool,
    __roadmapTool: roadmapTool,
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(module: 'PLANNER' | 'GPA' | 'ROADMAP' | 'CHAT') {
  return {
    userId: 42,
    module,
    trigger: 'USER',
    toolCallCount: 0,
    status: 'RUNNING',
  }
}

const IP = '127.0.0.1'

// Pull stub references from the mocked module (safe after jest.mock hoisting).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const registryMock = require('../tools/registry') as {
  __plannerTool: { execute: jest.Mock }
  __gpaTool: { execute: jest.Mock }
  __roadmapTool: { execute: jest.Mock }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  // recordToolCall and session update succeed silently by default
  mockCreate.mockResolvedValue({})
  mockUpdate.mockResolvedValue({})
  // updateMany returns { count: 1 } by default (slot claimed successfully)
  mockUpdateMany.mockResolvedValue({ count: 1 })
  // $transaction runs the callback (success path) by default
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      agentToolCall: { create: (...args: unknown[]) => mockCreate(...args) },
      complianceAuditLog: { create: jest.fn().mockResolvedValue({}) },
    }
    return callback(tx)
  })
  // Reset tool execute mocks to their default resolved values
  registryMock.__plannerTool.execute.mockResolvedValue({ tasks: [] })
  registryMock.__gpaTool.execute.mockResolvedValue({ gpa: 3.5 })
  registryMock.__roadmapTool.execute.mockResolvedValue({ plan: [] })
})

describe('dispatchTool — module-scope guardrail', () => {
  describe('non-CHAT sessions: cross-module calls are denied', () => {
    it('denies a PLANNER session calling a GPA tool', async () => {
      mockFindUnique.mockResolvedValue(makeSession('PLANNER'))

      const result = await dispatchTool(1, 'gpa_get_current_gpa', {}, IP)

      expect(result.success).toBe(false)
      expect(result.denialReason).toBe('ALLOWLIST')
      expect(registryMock.__gpaTool.execute).not.toHaveBeenCalled()
    })

    it('denies a GPA session calling a PLANNER tool', async () => {
      mockFindUnique.mockResolvedValue(makeSession('GPA'))

      const result = await dispatchTool(2, 'planner_get_tasks', {}, IP)

      expect(result.success).toBe(false)
      expect(result.denialReason).toBe('ALLOWLIST')
      expect(registryMock.__plannerTool.execute).not.toHaveBeenCalled()
    })

    it('denies a ROADMAP session calling a PLANNER tool', async () => {
      mockFindUnique.mockResolvedValue(makeSession('ROADMAP'))

      const result = await dispatchTool(3, 'planner_get_tasks', {}, IP)

      expect(result.success).toBe(false)
      expect(result.denialReason).toBe('ALLOWLIST')
      expect(registryMock.__plannerTool.execute).not.toHaveBeenCalled()
    })

    it('allows a PLANNER session calling its own tool', async () => {
      mockFindUnique.mockResolvedValue(makeSession('PLANNER'))

      const result = await dispatchTool(4, 'planner_get_tasks', {}, IP)

      expect(result.success).toBe(true)
      expect(registryMock.__plannerTool.execute).toHaveBeenCalledWith(42, {})
    })
  })

  describe('CHAT sessions: cross-module calls are allowed', () => {
    it('allows a CHAT session calling a PLANNER-registered tool', async () => {
      mockFindUnique.mockResolvedValue(makeSession('CHAT'))

      const result = await dispatchTool(5, 'planner_get_tasks', {}, IP)

      expect(result.success).toBe(true)
      expect(registryMock.__plannerTool.execute).toHaveBeenCalledWith(42, {})
    })

    it('allows a CHAT session calling a GPA-registered tool', async () => {
      mockFindUnique.mockResolvedValue(makeSession('CHAT'))

      const result = await dispatchTool(6, 'gpa_get_current_gpa', {}, IP)

      expect(result.success).toBe(true)
      expect(registryMock.__gpaTool.execute).toHaveBeenCalledWith(42, {})
    })

    it('allows a CHAT session calling a ROADMAP-registered tool', async () => {
      mockFindUnique.mockResolvedValue(makeSession('CHAT'))

      const result = await dispatchTool(7, 'roadmap_get_current_plan', {}, IP)

      expect(result.success).toBe(true)
      expect(registryMock.__roadmapTool.execute).toHaveBeenCalledWith(42, {})
    })

    it('still denies a CHAT session calling an unregistered tool name', async () => {
      mockFindUnique.mockResolvedValue(makeSession('CHAT'))

      const result = await dispatchTool(8, 'nonexistent_tool', {}, IP)

      expect(result.success).toBe(false)
      expect(result.denialReason).toBe('ALLOWLIST')
    })
  })
})
