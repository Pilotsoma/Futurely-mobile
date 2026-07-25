/**
 * Planner write tools for the agentic AI layer.
 *
 * Every write tool:
 * - Validates ownership before any mutation (query userId scope)
 * - Writes to compliance_audit_log after the DB mutation
 * - Rate limits enforced by AgentExecutionService before dispatch
 *
 * Bug 7 fix: every update/delete WHERE clause now includes userId in addition
 * to the record id. The prior requireAssignmentOwnership() check remains as
 * belt-and-suspenders, but the mutation itself is now also scoped so a
 * cross-user mutation is architecturally impossible at the DB layer regardless
 * of any future code path that might bypass the pre-check.
 *
 * Note: compliance_audit_log writes here are in addition to the per-call
 * writes in AgentExecutionService — these carry the affected resource ID.
 */

import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { writeAuditLog } from '../../../../lib/auditLog'

// ── Input schemas ─────────────────────────────────────────────────────────────

const CreateTaskInputSchema = z.object({
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(100),
  dueDate: z.string().min(1),   // ISO 8601 string
  estimatedMinutes: z.number().int().min(0).max(480).default(30),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
}).strict()

const UpdateTaskInputSchema = z.object({
  taskId: z.number().int().positive(),
  title: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(100).optional(),
  dueDate: z.string().min(1).optional(),
  estimatedMinutes: z.number().int().min(0).max(480).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
}).strict()

const TaskIdInputSchema = z.object({
  taskId: z.number().int().positive(),
}).strict()

// ── Ownership check helper ────────────────────────────────────────────────────

async function requireAssignmentOwnership(userId: number, taskId: number): Promise<void> {
  const assignment = await prisma.assignment.findFirst({
    where: { id: taskId, userId },
    select: { id: true },
  })
  if (assignment === null) {
    throw new Error(`Assignment ${taskId} not found or does not belong to the requesting user`)
  }
}

// ── Tool implementations ──────────────────────────────────────────────────────

export async function plannerCreateTask(
  userId: number,
  input: unknown,
): Promise<{ id: number; title: string; dueDate: string }> {
  const parsed = CreateTaskInputSchema.parse(input)

  const assignment = await prisma.assignment.create({
    data: {
      userId,
      title: parsed.title,
      subject: parsed.subject,
      dueDate: new Date(parsed.dueDate),
      estimatedMinutes: parsed.estimatedMinutes,
      priority: parsed.priority ?? null,
      source: 'AGENT',
    },
    select: { id: true, title: true, dueDate: true },
  })

  // Compliance audit log — includes affected resource ID
  await writeAuditLog({
    userId,
    resourceType: 'ASSIGNMENT',
    resourceId: String(assignment.id),
    action: 'planner_create_task',
    ipAddress: 'agent',
  })

  return {
    id: assignment.id,
    title: assignment.title,
    dueDate: assignment.dueDate.toISOString(),
  }
}

export async function plannerUpdateTask(
  userId: number,
  input: unknown,
): Promise<{ id: number; updated: boolean }> {
  const parsed = UpdateTaskInputSchema.parse(input)

  // Belt-and-suspenders ownership check before mutation
  await requireAssignmentOwnership(userId, parsed.taskId)

  const updateData: Record<string, unknown> = {}
  if (parsed.title !== undefined) updateData.title = parsed.title
  if (parsed.subject !== undefined) updateData.subject = parsed.subject
  if (parsed.dueDate !== undefined) updateData.dueDate = new Date(parsed.dueDate)
  if (parsed.estimatedMinutes !== undefined) updateData.estimatedMinutes = parsed.estimatedMinutes
  if (parsed.priority !== undefined) updateData.priority = parsed.priority

  if (Object.keys(updateData).length === 0) {
    return { id: parsed.taskId, updated: false }
  }

  // Bug 7 fix: WHERE clause includes userId so cross-user mutation is impossible
  // at the DB layer independent of the pre-check above.
  const result = await prisma.assignment.updateMany({
    where: { id: parsed.taskId, userId },
    data: updateData,
  })

  if (result.count === 0) {
    throw new Error(`Assignment ${parsed.taskId} not found or does not belong to the requesting user`)
  }

  await writeAuditLog({
    userId,
    resourceType: 'ASSIGNMENT',
    resourceId: String(parsed.taskId),
    action: 'planner_update_task',
    ipAddress: 'agent',
  })

  return { id: parsed.taskId, updated: true }
}

export async function plannerCompleteTask(
  userId: number,
  input: unknown,
): Promise<{ id: number; completedAt: string }> {
  const parsed = TaskIdInputSchema.parse(input)

  // Belt-and-suspenders ownership check before mutation
  await requireAssignmentOwnership(userId, parsed.taskId)

  const now = new Date()

  // Bug 7 fix: WHERE clause includes userId so cross-user mutation is impossible
  // at the DB layer independent of the pre-check above.
  const result = await prisma.assignment.updateMany({
    where: { id: parsed.taskId, userId },
    data: { completed: true, completedAt: now },
  })

  if (result.count === 0) {
    throw new Error(`Assignment ${parsed.taskId} not found or does not belong to the requesting user`)
  }

  await writeAuditLog({
    userId,
    resourceType: 'ASSIGNMENT',
    resourceId: String(parsed.taskId),
    action: 'planner_complete_task',
    ipAddress: 'agent',
  })

  return { id: parsed.taskId, completedAt: now.toISOString() }
}

export async function plannerDeleteTask(
  userId: number,
  input: unknown,
): Promise<{ id: number; deleted: boolean }> {
  const parsed = TaskIdInputSchema.parse(input)

  // Belt-and-suspenders ownership check before mutation
  await requireAssignmentOwnership(userId, parsed.taskId)

  // Bug 7 fix: WHERE clause includes userId so cross-user deletion is impossible
  // at the DB layer independent of the pre-check above.
  const result = await prisma.assignment.deleteMany({
    where: { id: parsed.taskId, userId },
  })

  if (result.count === 0) {
    throw new Error(`Assignment ${parsed.taskId} not found or does not belong to the requesting user`)
  }

  await writeAuditLog({
    userId,
    resourceType: 'ASSIGNMENT',
    resourceId: String(parsed.taskId),
    action: 'planner_delete_task',
    ipAddress: 'agent',
  })

  return { id: parsed.taskId, deleted: true }
}
