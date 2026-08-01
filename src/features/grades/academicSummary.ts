import type { CurrentGradeCourse, GpaSummary } from '../../types/grades'

export interface GpaDisplayValues {
  unweighted: number | null
  weighted: number | null
  courseCount: number
  averageGrade: number | null
}

const MAX_REASONABLE_GPA = 10
const MAX_REASONABLE_PERCENTAGE = 200

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toValidGpa(value: unknown): number | null {
  const parsed = toFiniteNumber(value)
  if (parsed === null || parsed < 0 || parsed > MAX_REASONABLE_GPA) return null
  return parsed
}

export function calculateAverageGrade(courses: CurrentGradeCourse[]): number | null {
  const validAverages = courses
    .map((course) => toFiniteNumber(course.average))
    .filter(
      (value): value is number =>
        value !== null && value >= 0 && value <= MAX_REASONABLE_PERCENTAGE,
    )

  if (validAverages.length === 0) return null
  return validAverages.reduce((sum, value) => sum + value, 0) / validAverages.length
}

export function getGpaDisplayValues(
  summary: GpaSummary | null,
  courses: CurrentGradeCourse[],
): GpaDisplayValues {
  const fallbackGpa = toValidGpa(summary?.gpa)

  return {
    unweighted: toValidGpa(summary?.unweightedGpa) ?? fallbackGpa,
    weighted: toValidGpa(summary?.weightedGpa) ?? fallbackGpa,
    courseCount: Math.max(
      0,
      Math.round(toFiniteNumber(summary?.courseCount) ?? courses.length),
    ),
    averageGrade: calculateAverageGrade(courses),
  }
}

export function formatGpa(value: number | null, hidden = false): string {
  if (hidden) return '••••'
  return value === null ? '—' : value.toFixed(3)
}
