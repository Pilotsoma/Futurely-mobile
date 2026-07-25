/**
 * Grade normalization layer.
 * Converts raw HAC and PowerSchool outputs into a single NormalizedCourse shape
 * that the NextStep mobile app consumes from /api/integrations/grades/current.
 */

import type { HACClass, HACScore } from './hacClient'
import type { PSClass } from './powerSchoolClient'

// ── Normalized output shape ────────────────────────────────────────────────────

export interface NormalizedAssignment {
  name: string
  category: string
  score: number | null
  totalPoints: number | null
  percentage: string
  dateDue: string
}

export interface NormalizedCourse {
  /** Stable string ID. HAC has no IDs so we generate from index + name. */
  id: string
  name: string
  teacher: string
  period: string
  average: number | null
  letterGrade: string | null
  assignments: NormalizedAssignment[]          // graded (has score)
  upcomingAssignments: NormalizedAssignment[]  // future (no score yet)
}

// ── GPA helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a grade average string like "92.4" or "N/A" to a float or null.
 */
function parseAverage(raw: string | null | undefined): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === 'N/A' || trimmed === '--' || trimmed === '-') return null
  const parsed = parseFloat(trimmed)
  return isNaN(parsed) ? null : parsed
}

/**
 * Derive a letter grade from a numeric average using standard US high school scale.
 * Returns null if average is null.
 */
function deriveLetterGrade(average: number | null): string | null {
  if (average === null) return null
  if (average >= 90) return 'A'
  if (average >= 80) return 'B'
  if (average >= 70) return 'C'
  if (average >= 60) return 'D'
  return 'F'
}

/**
 * Generate a stable course ID from index and course name.
 * HAC does not provide IDs, so we build a deterministic one.
 */
function makeCourseId(index: number, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 20)
  return `hac-${index}-${slug}`
}

// ── HAC normalization ──────────────────────────────────────────────────────────

/**
 * Convert a HACScore (raw assignment) to a NormalizedAssignment.
 */
function normalizeHacScore(score: HACScore): NormalizedAssignment {
  return {
    name: score.name?.trim() ?? 'Unnamed Assignment',
    category: score.category?.trim() ?? 'Uncategorized',
    score: score.score,
    totalPoints: score.totalPoints,
    percentage: score.percentage?.trim() ?? '',
    dateDue: score.dateDue?.trim() ?? '',
  }
}

/**
 * Convert an array of HACClass objects into NormalizedCourse[].
 * Safe to call with an empty array.
 */
export function normalizeHacGrades(classes: HACClass[]): NormalizedCourse[] {
  if (!Array.isArray(classes)) return []

  return classes.map((cls, index): NormalizedCourse => {
    const average = parseAverage(cls.average)
    const letterGrade = deriveLetterGrade(average)

    // Split assignments: graded (has score) vs upcoming (no score = future)
    const gradedAssignments = (cls.scores ?? []).filter(
      s => s.score !== null || s.totalPoints !== null
    )
    const upcomingAssignments = (cls.scores ?? []).filter(
      s => s.score === null && s.totalPoints === null
    )

    return {
      id: makeCourseId(index, cls.name ?? ''),
      name: cls.name?.trim() ?? 'Unknown Course',
      teacher: cls.teacher?.trim() ?? '',
      period: cls.period?.trim() ?? String(index + 1),
      average,
      letterGrade,
      assignments: gradedAssignments.map(normalizeHacScore),
      upcomingAssignments: upcomingAssignments.map(normalizeHacScore),
    }
  })
}

// ── PowerSchool normalization ──────────────────────────────────────────────────

/**
 * Convert an array of PSClass objects into NormalizedCourse[].
 * PowerSchool does not return assignment-level detail from the home page,
 * so assignments is always empty. Only course-level grade data is available.
 */
export function normalizePsGrades(rawClasses: PSClass[]): NormalizedCourse[] {
  if (!Array.isArray(rawClasses) || rawClasses.length === 0) return []

  return rawClasses
    .filter(cls => cls.name && cls.name.trim().length > 0)
    .map((cls, index): NormalizedCourse => {
      const rawGrade = cls.grade?.trim() ?? null

      let average: number | null = null
      let letterGrade: string | null = null

      if (rawGrade && rawGrade !== '--' && rawGrade !== '') {
        const asNum = parseFloat(rawGrade)

        if (!isNaN(asNum) && asNum >= 0 && asNum <= 100) {
          average = Math.round(asNum * 10) / 10
          letterGrade = deriveLetterGrade(average)
        } else if (/^[A-Fa-f][+-]?$/.test(rawGrade)) {
          letterGrade = rawGrade.toUpperCase()
          const letterToNum: Record<string, number> = {
            'A+': 98, 'A': 95, 'A-': 92,
            'B+': 88, 'B': 85, 'B-': 82,
            'C+': 78, 'C': 75, 'C-': 72,
            'D+': 68, 'D': 65, 'D-': 62,
            'F': 50,
          }
          average = letterToNum[letterGrade] ?? null
        }
      }

      return {
        id: `ps-${index}-${cls.name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20)}`,
        name: cls.name.trim(),
        teacher: 'See PowerSchool',
        period: String(index + 1),
        average,
        letterGrade,
        assignments: [],
        upcomingAssignments: [],
      }
    })
}

// ── GPA computation ────────────────────────────────────────────────────────────

/**
 * Compute unweighted GPA from normalized courses.
 * Uses 4.0 scale: A=4.0, B=3.0, C=2.0, D=1.0, F=0.0
 * Only includes courses that have a numeric average.
 */
export function computeGpaFromNormalized(courses: NormalizedCourse[]): number | null {
  const graded = courses.filter(c => c.average !== null)
  if (graded.length === 0) return null

  const pointMap: Record<string, number> = { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 }

  const total = graded.reduce((sum, c) => {
    const letter = c.letterGrade ?? 'F'
    return sum + (pointMap[letter] ?? 0)
  }, 0)

  const gpa = total / graded.length
  return Math.round(gpa * 1000) / 1000
}
