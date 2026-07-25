import { prisma } from '../../lib/prisma'

export interface RoadmapCore {
  gradeLevel: number
  graduationYear: number | null
  creditsCompleted: number
  creditsRequired: number
  creditsByCategory: Record<string, number>
  weightedGpa: number
  unweightedGpa: number
  futureDecision: string | null
}

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /english|literature|writing|composition|oral interp|reading/, category: 'English' },
  { pattern: /math|calculus|geometry|algebra|statistics|precalculus|reasoning/, category: 'Math' },
  { pattern: /biology|chemistry|physics|science|integrated physics/, category: 'Science' },
  { pattern: /history|government|economics|geography|social/, category: 'Social Studies' },
  { pattern: /spanish|french|chinese|latin|german|japanese/, category: 'Language' },
  { pattern: /art|music|theater|floral|design|photography|fine/, category: 'Fine Arts' },
  { pattern: /pe |physical|health|athletics|tennis|swimming|gym/, category: 'PE / Health' },
]

export function categorize(name: string): string {
  const n = name.toLowerCase()
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(n)) return category
  }
  return 'Electives'
}

export function deriveGradeLevel(graduationYear: number | null, stored: number | null): number {
  if (graduationYear !== null) {
    const now = new Date()
    const effectiveYear = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()
    const derived = 12 - (graduationYear - effectiveYear)
    if (derived >= 9 && derived <= 12) return derived
  }
  return stored ?? 9
}

export const CREDITS_REQUIRED = 26

export async function gatherRoadmapCore(userId: number): Promise<RoadmapCore> {
  const profile = await prisma.profile.findUnique({ where: { userId } })
  const courses = await prisma.course.findMany({
    where: { userId },
    include: { grades: { where: { gradingPeriod: 'CURRENT' }, take: 1 } },
  })

  const creditsByCategory: Record<string, number> = {
    English: 0, Math: 0, Science: 0, 'Social Studies': 0,
    Language: 0, 'Fine Arts': 0, 'PE / Health': 0, Electives: 0,
  }

  let creditsCompleted = 0
  for (const c of courses) {
    const grade = c.grades[0]
    const passed = grade !== undefined && grade.letterGrade !== 'F'
    if (passed) {
      creditsCompleted += c.creditHours
      const cat = categorize(c.name)
      creditsByCategory[cat] = (creditsByCategory[cat] ?? 0) + c.creditHours
    }
  }

  return {
    gradeLevel: deriveGradeLevel(profile?.graduationYear ?? null, profile?.gradeLevel ?? null),
    graduationYear: profile?.graduationYear ?? null,
    creditsCompleted,
    creditsRequired: CREDITS_REQUIRED,
    creditsByCategory,
    weightedGpa: profile?.weightedGpa ?? 0,
    unweightedGpa: profile?.unweightedGpa ?? 0,
    futureDecision: profile?.futureDecision ?? null,
  }
}
