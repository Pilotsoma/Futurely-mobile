export const LETTER_GRADES = [
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D+', 'D', 'D-',
  'F',
] as const

export type LetterGrade = (typeof LETTER_GRADES)[number]
export type CourseType  = 'STANDARD' | 'HONORS' | 'AP' | 'IB'

const GRADE_POINTS: Readonly<Record<LetterGrade, Readonly<Record<CourseType, number>>>> = {
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
  letterGrade: LetterGrade
  courseType:  CourseType
  creditHours: number
}

export interface GpaResult {
  weighted:   number
  unweighted: number
}

const COURSE_TYPES: readonly CourseType[] = ['STANDARD', 'HONORS', 'AP', 'IB']

export function isLetterGrade(s: string): s is LetterGrade {
  return (LETTER_GRADES as readonly string[]).includes(s)
}

export function isCourseType(s: string): s is CourseType {
  return (COURSE_TYPES as readonly string[]).includes(s)
}

export function calculateGpa(inputs: GradeInput[]): GpaResult | null {
  if (inputs.length === 0) return null

  const totalCredits = inputs.reduce((sum, g) => sum + g.creditHours, 0)
  if (totalCredits === 0) return null

  const weightedSum = inputs.reduce((sum, g) => {
    return sum + GRADE_POINTS[g.letterGrade][g.courseType] * g.creditHours
  }, 0)

  const unweightedSum = inputs.reduce((sum, g) => {
    return sum + GRADE_POINTS[g.letterGrade].STANDARD * g.creditHours
  }, 0)

  return {
    weighted:   Math.round((weightedSum   / totalCredits) * 100) / 100,
    unweighted: Math.round((unweightedSum / totalCredits) * 100) / 100,
  }
}
