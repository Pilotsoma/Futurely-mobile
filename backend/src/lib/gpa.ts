export const COURSE_TYPES = ['STANDARD', 'HONORS', 'AP', 'IB'] as const
export type CourseType = typeof COURSE_TYPES[number]

const GRADE_POINTS: Record<string, Record<CourseType, number>> = {
  'A+': { STANDARD: 4.0, HONORS: 4.5, AP: 5.0, IB: 5.0 },
  'A':  { STANDARD: 4.0, HONORS: 4.5, AP: 5.0, IB: 5.0 },
  'A-': { STANDARD: 3.7, HONORS: 4.2, AP: 4.7, IB: 4.7 },
  'B+': { STANDARD: 3.3, HONORS: 3.8, AP: 4.3, IB: 4.3 },
  'B':  { STANDARD: 3.0, HONORS: 3.5, AP: 4.0, IB: 4.0 },
  'B-': { STANDARD: 2.7, HONORS: 3.2, AP: 3.7, IB: 3.7 },
  'C+': { STANDARD: 2.3, HONORS: 2.8, AP: 3.3, IB: 3.3 },
  'C':  { STANDARD: 2.0, HONORS: 2.5, AP: 3.0, IB: 3.0 },
  'C-': { STANDARD: 1.7, HONORS: 2.2, AP: 2.7, IB: 2.7 },
  'D+': { STANDARD: 1.3, HONORS: 1.8, AP: 2.3, IB: 2.3 },
  'D':  { STANDARD: 1.0, HONORS: 1.5, AP: 2.0, IB: 2.0 },
  'D-': { STANDARD: 0.7, HONORS: 1.2, AP: 1.7, IB: 1.7 },
  'F':  { STANDARD: 0.0, HONORS: 0.0, AP: 0.0, IB: 0.0 },
}

export interface GradeInput {
  letterGrade: string
  creditHours: number
  courseType: string
}

export interface GpaResult {
  weighted: number
  unweighted: number
}

function resolveCourseType(raw: string): CourseType {
  return (COURSE_TYPES as readonly string[]).includes(raw)
    ? (raw as CourseType)
    : 'STANDARD'
}

export function calculateGpa(inputs: GradeInput[]): GpaResult | null {
  if (inputs.length === 0) return null

  let weightedSum = 0
  let unweightedSum = 0
  let creditSum = 0

  for (const input of inputs) {
    const points = GRADE_POINTS[input.letterGrade]
    if (points === undefined) continue

    const courseType = resolveCourseType(input.courseType)
    weightedSum += points[courseType] * input.creditHours
    unweightedSum += points['STANDARD'] * input.creditHours
    creditSum += input.creditHours
  }

  if (creditSum === 0) return null

  return {
    weighted: Math.round((weightedSum / creditSum) * 1000) / 1000,
    unweighted: Math.round((unweightedSum / creditSum) * 1000) / 1000,
  }
}
