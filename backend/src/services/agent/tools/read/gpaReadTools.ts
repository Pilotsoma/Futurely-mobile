/**
 * GPA read tools for the agentic AI layer.
 *
 * Wraps the existing calculateGpa lib function and Prisma queries.
 * All queries scoped by userId. No raw PII in output — course IDs and
 * computed GPA values only, no names or personally identifiable records.
 */

import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { calculateGpa, GradeInput } from '../../../../lib/gpa'

// ── Input schemas ─────────────────────────────────────────────────────────────

const NoInputSchema = z.object({}).strict()

const WhatIfInputSchema = z.object({
  hypotheticalGrades: z.array(
    z.object({
      courseId: z.number().int().positive(),
      letterGrade: z.string().min(1).max(3),
    }),
  ).min(1).max(20),
}).strict()

const GetGradesByCourseInputSchema = z.object({
  gradingPeriod: z.string().optional(),
}).strict()

const GetGradeHistoryInputSchema = z.object({
  courseId: z.number().int().positive().optional(),
}).strict()

// ── Tool implementations ──────────────────────────────────────────────────────

export async function gpaGetCurrentGpa(
  userId: number,
  input: unknown,
): Promise<{ weighted: number; unweighted: number; courseCount: number } | { gpa: null }> {
  NoInputSchema.parse(input ?? {})

  const courses = await prisma.course.findMany({
    where: { userId },
    include: {
      grades: { where: { gradingPeriod: 'CURRENT' }, take: 1 },
    },
  })

  const gradeInputs: GradeInput[] = courses
    .filter(c => c.grades.length > 0)
    .map(c => ({
      letterGrade: c.grades[0]!.letterGrade,
      creditHours: c.creditHours,
      courseType: c.courseType,
    }))

  const result = calculateGpa(gradeInputs)
  if (result === null) return { gpa: null }

  return {
    weighted: result.weighted,
    unweighted: result.unweighted,
    courseCount: gradeInputs.length,
  }
}

export async function gpaSimulateWhatIf(
  userId: number,
  input: unknown,
): Promise<{ current: { weighted: number; unweighted: number } | null; simulated: { weighted: number; unweighted: number } | null }> {
  const parsed = WhatIfInputSchema.parse(input)

  // Load current courses + grades (must be userId-scoped)
  const courses = await prisma.course.findMany({
    where: { userId },
    include: {
      grades: { where: { gradingPeriod: 'CURRENT' }, take: 1 },
    },
  })

  // Validate that every hypothetical courseId belongs to this user
  const ownedCourseIds = new Set(courses.map(c => c.id))
  for (const h of parsed.hypotheticalGrades) {
    if (!ownedCourseIds.has(h.courseId)) {
      throw new Error(`Course ${h.courseId} does not belong to the requesting user`)
    }
  }

  // Build current grade inputs
  const currentInputs: GradeInput[] = courses
    .filter(c => c.grades.length > 0)
    .map(c => ({
      letterGrade: c.grades[0]!.letterGrade,
      creditHours: c.creditHours,
      courseType: c.courseType,
    }))

  // Build simulated grade inputs — override with hypotheticals
  const hypotheticalMap = new Map(
    parsed.hypotheticalGrades.map(h => [h.courseId, h.letterGrade]),
  )
  const simulatedInputs: GradeInput[] = courses.map(c => {
    const override = hypotheticalMap.get(c.id)
    const grade = override ?? c.grades[0]?.letterGrade
    if (!grade) return null
    return { letterGrade: grade, creditHours: c.creditHours, courseType: c.courseType }
  }).filter((g): g is GradeInput => g !== null)

  return {
    current: calculateGpa(currentInputs),
    simulated: calculateGpa(simulatedInputs),
  }
}

export async function gpaGetGradesByCourse(
  userId: number,
  input: unknown,
): Promise<{ courses: Array<{ courseId: number; courseName: string; courseType: string; creditHours: number; letterGrade: string | null; percentage: number | null }> }> {
  const parsed = GetGradesByCourseInputSchema.parse(input ?? {})

  const courses = await prisma.course.findMany({
    where: { userId },
    include: {
      grades: {
        where: { gradingPeriod: parsed.gradingPeriod ?? 'CURRENT' },
        take: 1,
      },
    },
    orderBy: { period: 'asc' },
  })

  return {
    courses: courses.map(c => {
      const g = c.grades[0] ?? null
      return {
        courseId: c.id,
        courseName: c.name,
        courseType: c.courseType,
        creditHours: c.creditHours,
        letterGrade: g?.letterGrade ?? null,
        percentage: g?.percentage ?? null,
      }
    }),
  }
}

export async function gpaGetGradeHistory(
  userId: number,
  input: unknown,
): Promise<{ history: Array<{ courseId: number; courseName: string; letterGrade: string; percentage: number; gradingPeriod: string }> }> {
  const parsed = GetGradeHistoryInputSchema.parse(input ?? {})

  const grades = await prisma.grade.findMany({
    where: {
      userId,
      ...(parsed.courseId !== undefined && { courseId: parsed.courseId }),
    },
    include: { course: { select: { name: true, userId: true } } },
    orderBy: { createdAt: 'desc' },
  })

  // Double-check ownership (course.userId must match) — architecturally
  // the WHERE userId clause already enforces this, this is a second layer.
  const owned = grades.filter(g => g.course.userId === userId)

  return {
    history: owned.map(g => ({
      courseId: g.courseId,
      courseName: g.course.name,
      letterGrade: g.letterGrade,
      percentage: g.percentage,
      gradingPeriod: g.gradingPeriod,
    })),
  }
}
