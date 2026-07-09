// Official Katy ISD GPA scale — mirrors app/(app)/grades/what-if/page.tsx exactly.
// Used only for the client-side, non-persisting GPA simulator.

export type CourseLevel = 'Regular' | 'KAP' | 'AP' | 'Dual Credit'
export type GpaType = 'weighted' | 'unweighted'

export const GRADE_POINTS: Record<CourseLevel, Record<string, number>> = {
  Regular: { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 },
  KAP: { A: 5.0, B: 4.0, C: 3.0, D: 2.0, F: 0.0 },
  AP: { A: 5.0, B: 4.0, C: 3.0, D: 2.0, F: 0.0 },
  'Dual Credit': { A: 4.5, B: 3.5, C: 2.5, D: 1.5, F: 0.0 },
}

export function averageToLetter(average: number): string {
  if (average >= 90) return 'A'
  if (average >= 80) return 'B'
  if (average >= 70) return 'C'
  if (average >= 60) return 'D'
  return 'F'
}

export function gradePoints(average: number, level: CourseLevel, gpaType: GpaType): number {
  const letter = averageToLetter(average)
  if (gpaType === 'unweighted') return GRADE_POINTS.Regular[letter] ?? 0
  return GRADE_POINTS[level][letter] ?? 0
}

export function detectLevel(courseName: string): CourseLevel {
  const n = courseName.toUpperCase().trim()
  if (n.includes('AP ') || n.startsWith('AP') || n.includes('(AP)')) return 'AP'
  if (n.includes('KAP')) return 'KAP'
  if (n.includes('DUAL CREDIT') || n.includes('DC ') || n.includes('(DC)')) return 'Dual Credit'
  return 'Regular'
}
