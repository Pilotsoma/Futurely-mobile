/**
 * Roadmap read tools for the agentic AI layer.
 *
 * Wraps the gatherRoadmapCore shared service. No PII in output —
 * credit counts and computed values only, no student names or raw scores.
 */

import { z } from 'zod'
import { gatherRoadmapCore, CREDITS_REQUIRED, categorize } from '../../../../services/roadmap/roadmapCore.service'
import { prisma } from '../../../../lib/prisma'

const NoInputSchema = z.object({}).strict()

// Per-category graduation credit minimums (standard 26-credit plan)
const CATEGORY_MINIMUMS: Record<string, number> = {
  English: 4,
  Math: 4,
  Science: 4,
  'Social Studies': 3,
  Language: 2,
  'Fine Arts': 1,
  'PE / Health': 1,
}

// ── Tool implementations ──────────────────────────────────────────────────────

export async function roadmapGetCurrentPlan(
  userId: number,
  input: unknown,
): Promise<{
  gradeLevel: number
  graduationYear: number | null
  creditsCompleted: number
  creditsRequired: number
  percentComplete: number
  creditsByCategory: Record<string, number>
  weightedGpa: number
  unweightedGpa: number
  futureDecision: string | null
}> {
  NoInputSchema.parse(input ?? {})
  const core = await gatherRoadmapCore(userId)
  return {
    ...core,
    percentComplete: Math.round((core.creditsCompleted / core.creditsRequired) * 100),
  }
}

export async function roadmapSuggestCourses(
  userId: number,
  input: unknown,
): Promise<{
  creditGaps: Array<{ category: string; creditsEarned: number; creditsRequired: number; deficit: number }>
  suggestions: string[]
}> {
  NoInputSchema.parse(input ?? {})
  const core = await gatherRoadmapCore(userId)

  const creditGaps = Object.entries(CATEGORY_MINIMUMS)
    .map(([category, required]) => ({
      category,
      creditsEarned: core.creditsByCategory[category] ?? 0,
      creditsRequired: required,
      deficit: Math.max(0, required - (core.creditsByCategory[category] ?? 0)),
    }))
    .filter(g => g.deficit > 0)

  // Rule-based suggestions based on gaps — deterministic, no LLM call
  const suggestions: string[] = creditGaps.map(g => {
    switch (g.category) {
      case 'English': return `Enroll in ${g.deficit} more English credit(s): consider AP English Literature or Language`
      case 'Math': return `Add ${g.deficit} Math credit(s): Pre-Calculus, AP Calculus AB/BC, or AP Statistics`
      case 'Science': return `Add ${g.deficit} Science credit(s): AP Biology, Chemistry, Physics, or Environmental Science`
      case 'Social Studies': return `Add ${g.deficit} Social Studies credit(s): US History, Government, or Economics`
      case 'Language': return `Add ${g.deficit} World Language credit(s) to meet graduation requirement`
      case 'Fine Arts': return `Add ${g.deficit} Fine Arts credit(s): Art, Music, Theater, or Photography`
      case 'PE / Health': return `Add ${g.deficit} PE/Health credit(s) to meet graduation requirement`
      default: return `Add ${g.deficit} credit(s) in ${g.category}`
    }
  })

  return { creditGaps, suggestions }
}

export async function roadmapGetGraduationRequirements(
  userId: number,
  input: unknown,
): Promise<{
  totalCreditsRequired: number
  requirements: Array<{ category: string; required: number; earned: number; remaining: number; met: boolean }>
  overallProgress: { creditsCompleted: number; creditsRequired: number; percentComplete: number }
}> {
  NoInputSchema.parse(input ?? {})
  const core = await gatherRoadmapCore(userId)

  const requirements = Object.entries(CATEGORY_MINIMUMS).map(([category, required]) => {
    const earned = core.creditsByCategory[category] ?? 0
    return {
      category,
      required,
      earned,
      remaining: Math.max(0, required - earned),
      met: earned >= required,
    }
  })

  return {
    totalCreditsRequired: CREDITS_REQUIRED,
    requirements,
    overallProgress: {
      creditsCompleted: core.creditsCompleted,
      creditsRequired: core.creditsRequired,
      percentComplete: Math.round((core.creditsCompleted / core.creditsRequired) * 100),
    },
  }
}

export async function roadmapGetCollegeReadiness(
  userId: number,
  input: unknown,
): Promise<{
  readinessScore: number
  gradeLevel: number
  signals: Array<{ factor: string; status: 'strong' | 'developing' | 'needs_attention'; detail: string }>
  collegeList: Array<{ id: number; name: string }>
}> {
  NoInputSchema.parse(input ?? {})

  const [core, collegeList, profile] = await Promise.all([
    gatherRoadmapCore(userId),
    prisma.collegeListItem.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
      take: 10,
    }),
    prisma.studentProfile.findUnique({
      where: { userId },
      select: { satScore: true, actScore: true },
    }),
  ])

  const signals: Array<{ factor: string; status: 'strong' | 'developing' | 'needs_attention'; detail: string }> = []

  // GPA signal
  if (core.weightedGpa >= 3.7) {
    signals.push({ factor: 'GPA', status: 'strong', detail: 'Weighted GPA is competitive for selective colleges' })
  } else if (core.weightedGpa >= 3.0) {
    signals.push({ factor: 'GPA', status: 'developing', detail: 'GPA is solid; continuing to improve will strengthen applications' })
  } else {
    signals.push({ factor: 'GPA', status: 'needs_attention', detail: 'GPA improvement is a priority for college readiness' })
  }

  // Credit progress signal
  const creditPct = core.creditsCompleted / core.creditsRequired
  if (creditPct >= 0.75) {
    signals.push({ factor: 'Credits', status: 'strong', detail: 'On track with credit completion toward graduation' })
  } else if (creditPct >= 0.5) {
    signals.push({ factor: 'Credits', status: 'developing', detail: 'Making progress on credits; monitor subject-area gaps' })
  } else {
    signals.push({ factor: 'Credits', status: 'needs_attention', detail: 'Credit completion needs attention to stay on graduation track' })
  }

  // Course rigor signal (count AP/IB courses)
  const rigorousCourses = await prisma.course.count({
    where: { userId, courseType: { in: ['AP', 'IB', 'HONORS'] } },
  })
  if (rigorousCourses >= 4) {
    signals.push({ factor: 'Course Rigor', status: 'strong', detail: `${rigorousCourses} AP/IB/Honors courses demonstrate academic challenge` })
  } else if (rigorousCourses >= 2) {
    signals.push({ factor: 'Course Rigor', status: 'developing', detail: `${rigorousCourses} rigorous courses; consider adding more AP or Honors sections` })
  } else {
    signals.push({ factor: 'Course Rigor', status: 'needs_attention', detail: 'Adding AP or Honors courses will strengthen college applications' })
  }

  // Test scores signal
  const hasSat = (profile?.satScore ?? 0) > 0
  const hasAct = (profile?.actScore ?? 0) > 0
  if (hasSat || hasAct) {
    signals.push({ factor: 'Test Scores', status: 'strong', detail: 'Standardized test scores are on file' })
  } else if (core.gradeLevel >= 11) {
    signals.push({ factor: 'Test Scores', status: 'needs_attention', detail: 'No SAT/ACT scores on file — consider registering for an upcoming test date' })
  } else {
    signals.push({ factor: 'Test Scores', status: 'developing', detail: 'Consider SAT/ACT preparation as you approach junior year' })
  }

  // College list signal
  if (collegeList.length >= 5) {
    signals.push({ factor: 'College List', status: 'strong', detail: `${collegeList.length} colleges on your list` })
  } else if (collegeList.length > 0) {
    signals.push({ factor: 'College List', status: 'developing', detail: `${collegeList.length} college(s) on list; building a diverse list of 8-12 is recommended` })
  } else {
    signals.push({ factor: 'College List', status: 'needs_attention', detail: 'No colleges on your list yet — start researching schools that fit your goals' })
  }

  // Overall readiness score (0-100)
  const scoreMap: Record<string, number> = { strong: 100, developing: 60, needs_attention: 20 }
  const readinessScore = Math.round(
    signals.reduce((sum, s) => sum + scoreMap[s.status]!, 0) / signals.length,
  )

  return {
    readinessScore,
    gradeLevel: core.gradeLevel,
    signals,
    collegeList: collegeList.map(c => ({ id: c.id, name: c.name })),
  }
}

// Re-export categorize for use by roadmap tools that need it
export { categorize }
