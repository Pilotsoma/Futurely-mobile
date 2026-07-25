/**
 * Roadmap write tools for the agentic AI layer.
 *
 * roadmap_apply_course_change is excluded from autonomous (SYSTEM) sessions —
 * enforced by AgentExecutionService before this function is ever called.
 * Rate limit: 5/hr, also enforced pre-call by AgentExecutionService.
 *
 * Bug 7 fix: every course.update WHERE clause now includes userId in addition
 * to the record id. The prior ownership findFirst check remains as
 * belt-and-suspenders, but the mutation itself is now also scoped so a
 * cross-user mutation is architecturally impossible at the DB layer
 * regardless of any future code path that might bypass the pre-check.
 *
 * The rationale field is required and stored in the compliance audit log.
 */

import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { writeAuditLog } from '../../../../lib/auditLog'

// ── Input schema ──────────────────────────────────────────────────────────────

const ApplyCourseChangeInputSchema = z.object({
  courseId: z.number().int().positive(),
  field: z.enum(['courseType', 'creditHours']),
  newValue: z.string().min(1).max(50),
  rationale: z.string().min(10).max(500),
}).strict()

const VALID_COURSE_TYPES = new Set(['STANDARD', 'HONORS', 'AP', 'IB'])

// ── Tool implementation ───────────────────────────────────────────────────────

export async function roadmapApplyCourseChange(
  userId: number,
  input: unknown,
): Promise<{ courseId: number; field: string; newValue: string; applied: boolean }> {
  const parsed = ApplyCourseChangeInputSchema.parse(input)

  // Belt-and-suspenders ownership check — query must scope by userId
  const course = await prisma.course.findFirst({
    where: { id: parsed.courseId, userId },
    select: { id: true, name: true, courseType: true, creditHours: true },
  })

  if (course === null) {
    throw new Error(`Course ${parsed.courseId} not found or does not belong to the requesting user`)
  }

  // Validate newValue based on field
  if (parsed.field === 'courseType') {
    if (!VALID_COURSE_TYPES.has(parsed.newValue)) {
      throw new Error(`Invalid courseType "${parsed.newValue}". Must be one of: STANDARD, HONORS, AP, IB`)
    }

    // Bug 7 fix: WHERE clause includes userId so cross-user mutation is
    // impossible at the DB layer independent of the pre-check above.
    const result = await prisma.course.updateMany({
      where: { id: parsed.courseId, userId },
      data: { courseType: parsed.newValue },
    })

    if (result.count === 0) {
      throw new Error(`Course ${parsed.courseId} not found or does not belong to the requesting user`)
    }
  } else {
    const credits = parseFloat(parsed.newValue)
    if (isNaN(credits) || credits <= 0 || credits > 4) {
      throw new Error(`Invalid creditHours "${parsed.newValue}". Must be a positive number up to 4.0`)
    }

    // Bug 7 fix: WHERE clause includes userId so cross-user mutation is
    // impossible at the DB layer independent of the pre-check above.
    const result = await prisma.course.updateMany({
      where: { id: parsed.courseId, userId },
      data: { creditHours: credits },
    })

    if (result.count === 0) {
      throw new Error(`Course ${parsed.courseId} not found or does not belong to the requesting user`)
    }
  }

  // Compliance audit log — rationale stored in resourceId field
  // (prefixed with courseId: to allow recovery; rationale is the human-readable reason)
  await writeAuditLog({
    userId,
    resourceType: 'COURSE',
    resourceId: `${parsed.courseId}:${parsed.rationale.slice(0, 200)}`,
    action: 'roadmap_apply_course_change',
    ipAddress: 'agent',
  })

  return {
    courseId: parsed.courseId,
    field: parsed.field,
    newValue: parsed.newValue,
    applied: true,
  }
}
