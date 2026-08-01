import {
  calculateAverageGrade,
  formatGpa,
  getGpaDisplayValues,
  toFiniteNumber,
} from '../academicSummary'
import type { CurrentGradeCourse, GpaSummary } from '../../../types/grades'

function course(average: number | null): CurrentGradeCourse {
  return {
    id: String(average ?? 'empty'),
    name: 'Course',
    teacher: 'Teacher',
    period: '1',
    average,
    letterGrade: average === null ? null : 'A',
    assignments: [],
    upcomingAssignments: [],
  }
}

const summary: GpaSummary = {
  gpa: 3.4,
  unweightedGpa: 3.4567,
  weightedGpa: 4.1234,
  courseCount: 2,
  systemType: 'HAC',
}

describe('academic summary', () => {
  it('uses the portal GPA values and calculates the course average', () => {
    expect(getGpaDisplayValues(summary, [course(92), course(88)])).toEqual({
      unweighted: 3.4567,
      weighted: 4.1234,
      courseCount: 2,
      averageGrade: 90,
    })
  })

  it('formats both GPA values to exactly three decimal places', () => {
    expect(formatGpa(3.4567)).toBe('3.457')
    expect(formatGpa(4)).toBe('4.000')
  })

  it('falls back to the shared GPA field when a weighted value is missing', () => {
    expect(
      getGpaDisplayValues(
        { ...summary, unweightedGpa: null, weightedGpa: null },
        [],
      ),
    ).toMatchObject({ unweighted: 3.4, weighted: 3.4 })
  })

  it('preserves an empty GPA instead of converting it to a misleading zero', () => {
    const values = getGpaDisplayValues(
      { ...summary, gpa: null, unweightedGpa: null, weightedGpa: null },
      [],
    )
    expect(values.unweighted).toBeNull()
    expect(values.weighted).toBeNull()
    expect(formatGpa(values.unweighted)).toBe('—')
  })

  it('rejects invalid GPA and grade values', () => {
    const values = getGpaDisplayValues(
      { ...summary, gpa: Number.NaN, unweightedGpa: -1, weightedGpa: 99 },
      [course(Number.NaN), course(-5), course(250)],
    )
    expect(values.unweighted).toBeNull()
    expect(values.weighted).toBeNull()
    expect(values.averageGrade).toBeNull()
    expect(toFiniteNumber('not-a-number')).toBeNull()
  })

  it('ignores missing grades when averaging', () => {
    expect(calculateAverageGrade([course(90), course(null), course(80)])).toBe(85)
    expect(calculateAverageGrade([])).toBeNull()
  })

  it('uses the privacy placeholder when GPA visibility is disabled', () => {
    expect(formatGpa(3.8, true)).toBe('••••')
    expect(formatGpa(null, true)).toBe('••••')
  })
})
