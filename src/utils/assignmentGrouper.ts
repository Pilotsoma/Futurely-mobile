import type { Assignment } from '../api/assignmentsApi'

export type SectionKey = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'completed'

export interface PlannerSection {
  key: SectionKey
  label: string
  assignments: Assignment[]
}

const SECTION_ORDER: SectionKey[] = [
  'overdue',
  'today',
  'tomorrow',
  'thisWeek',
  'later',
  'completed',
]

const SECTION_LABELS: Record<SectionKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This Week',
  later: 'Later',
  completed: 'Completed',
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function bucketAssignment(
  assignment: Assignment,
  today: Date,
  tomorrow: Date,
  dayAfterTomorrow: Date,
  weekEnd: Date,
): SectionKey {
  if (assignment.completed) return 'completed'
  const due = new Date(assignment.dueDate)
  if (due < today) return 'overdue'
  if (due < tomorrow) return 'today'
  if (due < dayAfterTomorrow) return 'tomorrow'
  if (due <= weekEnd) return 'thisWeek'
  return 'later'
}

export function groupAssignments(assignments: Assignment[], now = new Date()): PlannerSection[] {
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)
  const dayAfterTomorrow = addDays(tomorrow, 1)
  const weekEnd = endOfDay(addDays(today, 6))

  const buckets: Record<SectionKey, Assignment[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: [],
    completed: [],
  }

  for (const a of assignments) {
    buckets[bucketAssignment(a, today, tomorrow, dayAfterTomorrow, weekEnd)].push(a)
  }

  return SECTION_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    label: SECTION_LABELS[key],
    assignments: buckets[key],
  }))
}
