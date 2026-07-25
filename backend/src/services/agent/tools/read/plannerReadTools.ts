/**
 * Planner read tools for the agentic AI layer.
 *
 * All queries are scoped by userId — cross-user data access is architecturally
 * impossible because userId is injected by AgentExecutionService, not by the LLM.
 * No PII in tool output: IDs and computed values only (no student names in logs).
 */

import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'

// ── Input schemas ─────────────────────────────────────────────────────────────

const GetTasksInputSchema = z.object({
  status: z.enum(['incomplete', 'complete', 'all']).default('all'),
  limit: z.number().int().min(1).max(50).default(20),
}).strict()

const GetUpcomingDeadlinesInputSchema = z.object({
  daysAhead: z.number().int().min(1).max(30).default(7),
  limit: z.number().int().min(1).max(20).default(10),
}).strict()

// ── Output types ──────────────────────────────────────────────────────────────

interface TaskSummary {
  id: number
  title: string
  subject: string
  dueDate: string
  estimatedMinutes: number
  completed: boolean
  priority: string | null
}

// ── Tool implementations ──────────────────────────────────────────────────────

export async function plannerGetTasks(
  userId: number,
  input: unknown,
): Promise<{ tasks: TaskSummary[]; totalCount: number }> {
  const parsed = GetTasksInputSchema.parse(input ?? {})

  const where = {
    userId,
    ...(parsed.status === 'incomplete' && { completed: false }),
    ...(parsed.status === 'complete' && { completed: true }),
  }

  const [tasks, totalCount] = await Promise.all([
    prisma.assignment.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      take: parsed.limit,
      select: {
        id: true,
        title: true,
        subject: true,
        dueDate: true,
        estimatedMinutes: true,
        completed: true,
        priority: true,
      },
    }),
    prisma.assignment.count({ where }),
  ])

  return {
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      subject: t.subject,
      dueDate: t.dueDate.toISOString(),
      estimatedMinutes: t.estimatedMinutes ?? 0,
      completed: t.completed,
      priority: t.priority,
    })),
    totalCount,
  }
}

export async function plannerGetUpcomingDeadlines(
  userId: number,
  input: unknown,
): Promise<{ deadlines: TaskSummary[] }> {
  const parsed = GetUpcomingDeadlinesInputSchema.parse(input ?? {})

  const now = new Date()
  const cutoff = new Date(now.getTime() + parsed.daysAhead * 24 * 60 * 60 * 1000)

  const tasks = await prisma.assignment.findMany({
    where: {
      userId,
      completed: false,
      dueDate: { gte: now, lte: cutoff },
    },
    orderBy: { dueDate: 'asc' },
    take: parsed.limit,
    select: {
      id: true,
      title: true,
      subject: true,
      dueDate: true,
      estimatedMinutes: true,
      completed: true,
      priority: true,
    },
  })

  return {
    deadlines: tasks.map(t => ({
      id: t.id,
      title: t.title,
      subject: t.subject,
      dueDate: t.dueDate.toISOString(),
      estimatedMinutes: t.estimatedMinutes ?? 0,
      completed: t.completed,
      priority: t.priority,
    })),
  }
}
