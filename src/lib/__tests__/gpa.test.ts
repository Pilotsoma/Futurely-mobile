import { calculateGpa, isLetterGrade, isCourseType, type GradeInput } from '../gpa'

// ─── Seeded test data ─────────────────────────────────────────────────────────
// Mirrors backend/prisma/seed.ts exactly so simulator output matches Grade Viewer

const SEEDED_COURSES: GradeInput[] = [
  { letterGrade: 'A-', courseType: 'AP',       creditHours: 1.0 },
  { letterGrade: 'B+', courseType: 'AP',       creditHours: 1.0 },
  { letterGrade: 'A',  courseType: 'STANDARD', creditHours: 1.0 },
  { letterGrade: 'B',  courseType: 'STANDARD', creditHours: 1.0 },
  { letterGrade: 'B+', courseType: 'HONORS',   creditHours: 1.0 },
  { letterGrade: 'A',  courseType: 'STANDARD', creditHours: 1.0 },
]

// ─── calculateGpa ─────────────────────────────────────────────────────────────

describe('calculateGpa', () => {
  it('returns null for empty input', () => {
    expect(calculateGpa([])).toBeNull()
  })

  it('returns null when total credit hours are zero', () => {
    const inputs: GradeInput[] = [
      { letterGrade: 'A', courseType: 'STANDARD', creditHours: 0 },
    ]
    expect(calculateGpa(inputs)).toBeNull()
  })

  it('matches backend seeded weighted GPA (3.97)', () => {
    const result = calculateGpa(SEEDED_COURSES)
    expect(result?.weighted).toBe(3.97)
  })

  it('matches backend seeded unweighted GPA (3.55)', () => {
    const result = calculateGpa(SEEDED_COURSES)
    expect(result?.unweighted).toBe(3.55)
  })

  it('all courses at A gives unweighted GPA of exactly 4.0', () => {
    const allA: GradeInput[] = SEEDED_COURSES.map((c) => ({ ...c, letterGrade: 'A' as const }))
    const result = calculateGpa(allA)
    expect(result?.unweighted).toBe(4.0)
  })

  it('AP course at A contributes 5.0 weighted points, pushing GPA above 4.0', () => {
    const allA: GradeInput[] = SEEDED_COURSES.map((c) => ({ ...c, letterGrade: 'A' as const }))
    const result = calculateGpa(allA)
    expect(result?.weighted).toBeGreaterThan(4.0)
  })

  it('changing AP English from A- to F drops weighted GPA by ~0.79', () => {
    const withF: GradeInput[] = [...SEEDED_COURSES]
    withF[0] = { ...withF[0], letterGrade: 'F' }
    const original  = calculateGpa(SEEDED_COURSES)
    const projected = calculateGpa(withF)
    const delta = (projected?.weighted ?? 0) - (original?.weighted ?? 0)
    expect(delta).toBeLessThan(-0.5)
  })

  it('F grade contributes 0.0 points for every course type', () => {
    const fStandard = calculateGpa([{ letterGrade: 'F', courseType: 'STANDARD', creditHours: 1 }])
    const fAp       = calculateGpa([{ letterGrade: 'F', courseType: 'AP',       creditHours: 1 }])
    const fHonors   = calculateGpa([{ letterGrade: 'F', courseType: 'HONORS',   creditHours: 1 }])
    expect(fStandard?.weighted).toBe(0.0)
    expect(fAp?.weighted).toBe(0.0)
    expect(fHonors?.weighted).toBe(0.0)
  })

  it('AP courses earn more weighted points than STANDARD for same letter grade', () => {
    const ap       = calculateGpa([{ letterGrade: 'B', courseType: 'AP',       creditHours: 1 }])
    const standard = calculateGpa([{ letterGrade: 'B', courseType: 'STANDARD', creditHours: 1 }])
    expect((ap?.weighted ?? 0)).toBeGreaterThan(standard?.weighted ?? 0)
  })

  it('HONORS earns more weighted points than STANDARD for same letter grade', () => {
    const honors   = calculateGpa([{ letterGrade: 'B', courseType: 'HONORS',   creditHours: 1 }])
    const standard = calculateGpa([{ letterGrade: 'B', courseType: 'STANDARD', creditHours: 1 }])
    expect((honors?.weighted ?? 0)).toBeGreaterThan(standard?.weighted ?? 0)
  })

  it('credit hours are weighted proportionally', () => {
    const inputs: GradeInput[] = [
      { letterGrade: 'A', courseType: 'STANDARD', creditHours: 2.0 },
      { letterGrade: 'F', courseType: 'STANDARD', creditHours: 1.0 },
    ]
    const result = calculateGpa(inputs)
    // (4.0*2 + 0.0*1) / 3 = 8/3 = 2.67
    expect(result?.unweighted).toBe(2.67)
  })

  it('result is rounded to 2 decimal places', () => {
    const result = calculateGpa(SEEDED_COURSES)
    const str = result?.weighted.toString() ?? ''
    const decimals = str.includes('.') ? str.split('.')[1].length : 0
    expect(decimals).toBeLessThanOrEqual(2)
  })
})

// ─── Type guards ──────────────────────────────────────────────────────────────

describe('isLetterGrade', () => {
  it('accepts all 13 valid letter grades', () => {
    const valid = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']
    valid.forEach((g) => expect(isLetterGrade(g)).toBe(true))
  })

  it('rejects invalid strings', () => {
    expect(isLetterGrade('E')).toBe(false)
    expect(isLetterGrade('')).toBe(false)
    expect(isLetterGrade('a')).toBe(false)
    expect(isLetterGrade('4.0')).toBe(false)
  })
})

describe('isCourseType', () => {
  it('accepts all 4 valid course types', () => {
    expect(isCourseType('STANDARD')).toBe(true)
    expect(isCourseType('HONORS')).toBe(true)
    expect(isCourseType('AP')).toBe(true)
    expect(isCourseType('IB')).toBe(true)
  })

  it('rejects invalid strings', () => {
    expect(isCourseType('standard')).toBe(false)
    expect(isCourseType('AP ')).toBe(false)
    expect(isCourseType('')).toBe(false)
  })
})
