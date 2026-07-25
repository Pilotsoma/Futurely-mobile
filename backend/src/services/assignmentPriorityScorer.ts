// Classifies an assignment as HIGH / MEDIUM / LOW priority.
//
// This used to be an LLM call, but the classification rule was already fully
// deterministic (see the thresholds below) — handing a rule the prompt spells
// out verbatim to an LLM just to have it echo back one of three words added
// latency, cost, and a failure-fallback-to-MEDIUM path for no benefit over
// evaluating the same rule directly.

import { prisma } from '../lib/prisma'
import { logger } from '../common/logger'
import { writeAuditLog } from '../lib/auditLog'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AssignmentPriority = 'HIGH' | 'MEDIUM' | 'LOW'

export interface AssignmentInput {
  title: string
  subject: string
  dueDate: Date
  estimatedMinutes?: number | null
}

// ---------------------------------------------------------------------------
// Primary scoring function
// ---------------------------------------------------------------------------

const CORE_SUBJECTS = new Set(['math', 'science', 'english', 'history'])

// Classification criteria (unchanged from the original LLM prompt):
// - HIGH: due within 24 hours, OR estimated time greater than 90 minutes,
//         OR subject is a core class (Math, Science, English, History) with
//         less than 48 hours until due
// - MEDIUM: due in 24–72 hours
// - LOW: due more than 72 hours away (and not otherwise HIGH)
export async function scoreAssignmentPriority(
  input: AssignmentInput,
): Promise<AssignmentPriority> {
  const hoursUntilDue = (input.dueDate.getTime() - Date.now()) / (1000 * 60 * 60)
  const isCoreSubject = CORE_SUBJECTS.has(input.subject.trim().toLowerCase())

  if (
    hoursUntilDue <= 24 ||
    (input.estimatedMinutes != null && input.estimatedMinutes > 90) ||
    (isCoreSubject && hoursUntilDue <= 48)
  ) {
    return 'HIGH'
  }

  if (hoursUntilDue <= 72) {
    return 'MEDIUM'
  }

  return 'LOW'
}

// ---------------------------------------------------------------------------
// Persist helper — called by the route layer (batch or fire-and-forget)
// ---------------------------------------------------------------------------

export async function scoreSingleAssignmentPriority(
  assignmentId: number,
  userId: number,
  input: AssignmentInput,
): Promise<void> {
  try {
    const priority = await scoreAssignmentPriority(input)

    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { priority },
    })

    await writeAuditLog({
      userId,
      resourceType: 'ASSIGNMENT',
      resourceId: String(assignmentId),
      action: 'AI_PRIORITY_SCORED',
      // This function is called server-side (background/batch), not from an
      // HTTP request handler, so there is no client IP available. 'system'
      // signals an internal automated write, consistent with how other
      // server-side audit writes in this codebase handle the field.
      ipAddress: 'system',
    })
  } catch (error) {
    // Never throw — callers may fire-and-forget and a thrown error would
    // silently swallow the parent request's response or crash a worker.
    logger.warn('assignment_priority_scorer_persist_error', {
      feature: 'assignmentPriorityScorer',
      assignmentId,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}
