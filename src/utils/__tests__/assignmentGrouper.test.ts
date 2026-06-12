import type { Assignment } from '../../api/assignmentsApi'
import { groupAssignments, type SectionKey } from '../assignmentGrouper'

// All dates use the local Date constructor so boundaries and due times
// share the same timezone offset — tests pass in any runtime timezone.
const NOW = new Date(2026, 5, 1, 12, 0, 0, 0) // June 1, 2026 noon local

function localDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0)
}

function makeAssignment(id: number, dueDate: Date, completed = false): Assignment {
  return {
    id,
    userId: 1,
    title: `Assignment ${id}`,
    subject: 'Math',
    dueDate: dueDate.toISOString(),
    estimatedMinutes: 30,
    completed,
    completedAt: completed ? new Date().toISOString() : null,
    source: 'SEED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function sectionKeys(sections: ReturnType<typeof groupAssignments>): SectionKey[] {
  return sections.map((s) => s.key)
}

describe('groupAssignments — section bucketing', () => {
  it('buckets a past-due incomplete assignment as overdue', () => {
    const a = makeAssignment(1, localDate(2026, 5, 30)) // May 30
    const sections = groupAssignments([a], NOW)
    expect(sectionKeys(sections)).toContain('overdue')
    expect(sections.find((s) => s.key === 'overdue')?.assignments).toHaveLength(1)
  })

  it('buckets an assignment due today as today', () => {
    const a = makeAssignment(2, localDate(2026, 6, 1, 20)) // June 1 8 PM local
    const sections = groupAssignments([a], NOW)
    expect(sectionKeys(sections)).toContain('today')
    expect(sections.find((s) => s.key === 'today')?.assignments).toHaveLength(1)
  })

  it('buckets an assignment due tomorrow as tomorrow', () => {
    const a = makeAssignment(3, localDate(2026, 6, 2, 10)) // June 2 local
    const sections = groupAssignments([a], NOW)
    expect(sectionKeys(sections)).toContain('tomorrow')
  })

  it('buckets assignments due in 2–6 days as thisWeek', () => {
    const a1 = makeAssignment(4, localDate(2026, 6, 3))  // +2 days
    const a2 = makeAssignment(5, localDate(2026, 6, 7))  // +6 days (weekEnd)
    const sections = groupAssignments([a1, a2], NOW)
    const thisWeek = sections.find((s) => s.key === 'thisWeek')
    expect(thisWeek?.assignments).toHaveLength(2)
  })

  it('buckets an assignment due 7+ days out as later', () => {
    const a = makeAssignment(6, localDate(2026, 6, 10)) // +9 days
    const sections = groupAssignments([a], NOW)
    expect(sectionKeys(sections)).toContain('later')
  })

  it('buckets completed assignments into completed regardless of due date', () => {
    const overdueButDone = makeAssignment(7, localDate(2026, 5, 28), true)
    const futureButDone  = makeAssignment(8, localDate(2026, 6, 10), true)
    const sections = groupAssignments([overdueButDone, futureButDone], NOW)
    const completed = sections.find((s) => s.key === 'completed')
    expect(completed?.assignments).toHaveLength(2)
    expect(sectionKeys(sections)).not.toContain('overdue')
    expect(sectionKeys(sections)).not.toContain('later')
  })

  it('excludes empty sections from output', () => {
    const a = makeAssignment(9, localDate(2026, 6, 1, 20))
    const sections = groupAssignments([a], NOW)
    const keys = sectionKeys(sections)
    expect(keys).toContain('today')
    expect(keys).not.toContain('overdue')
    expect(keys).not.toContain('tomorrow')
    expect(keys).not.toContain('completed')
  })

  it('returns an empty array for no assignments', () => {
    expect(groupAssignments([], NOW)).toHaveLength(0)
  })

  it('preserves SECTION_ORDER sort: overdue → today → tomorrow → thisWeek → later → completed', () => {
    const assignments = [
      makeAssignment(1, localDate(2026, 5, 30)),        // overdue
      makeAssignment(2, localDate(2026, 6, 1, 20)),     // today
      makeAssignment(3, localDate(2026, 6, 2, 10)),     // tomorrow
      makeAssignment(4, localDate(2026, 6, 4)),         // thisWeek
      makeAssignment(5, localDate(2026, 6, 10)),        // later
      makeAssignment(6, localDate(2026, 5, 28), true),  // completed
    ]
    const sections = groupAssignments(assignments, NOW)
    expect(sectionKeys(sections)).toEqual([
      'overdue', 'today', 'tomorrow', 'thisWeek', 'later', 'completed',
    ])
  })

  it('weekEnd boundary: day 6 from today is thisWeek, day 7 is later', () => {
    const day6 = makeAssignment(10, localDate(2026, 6, 7, 23))  // +6 days end of day
    const day7 = makeAssignment(11, localDate(2026, 6, 8, 1))   // +7 days start
    const sections = groupAssignments([day6, day7], NOW)
    const keys = sectionKeys(sections)
    expect(keys).toContain('thisWeek')
    expect(keys).toContain('later')
    const thisWeek = sections.find((s) => s.key === 'thisWeek')
    const later    = sections.find((s) => s.key === 'later')
    expect(thisWeek?.assignments[0].id).toBe(10)
    expect(later?.assignments[0].id).toBe(11)
  })
})
