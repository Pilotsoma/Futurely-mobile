import type { Assignment } from '../../types/assignments'

const PRIORITY_ORDER: Record<string, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
}

function validDate(value: string): Date | null {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function isSameLocalCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

export function getDueTodayAssignments(
  assignments: Assignment[],
  now = new Date(),
): Assignment[] {
  return assignments
    .filter((assignment) => {
      if (assignment.completed) return false
      const dueDate = validDate(assignment.dueDate)
      return dueDate !== null && isSameLocalCalendarDay(dueDate, now)
    })
    .sort((left, right) => {
      const leftDate = validDate(left.dueDate)
      const rightDate = validDate(right.dueDate)
      const timeDifference = (leftDate?.getTime() ?? 0) - (rightDate?.getTime() ?? 0)
      if (timeDifference !== 0) return timeDifference

      const priorityDifference =
        (PRIORITY_ORDER[left.priority?.toUpperCase() ?? ''] ?? 3) -
        (PRIORITY_ORDER[right.priority?.toUpperCase() ?? ''] ?? 3)
      if (priorityDifference !== 0) return priorityDifference

      return left.title.localeCompare(right.title)
    })
}

export function formatAssignmentDueTime(assignment: Assignment): string {
  if (assignment.dueTime?.trim()) return assignment.dueTime.trim()

  const dueDate = validDate(assignment.dueDate)
  if (!dueDate) return 'Time unavailable'

  return dueDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function getAssignmentDestination(assignmentId: number): {
  assignmentId: number
} | null {
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) return null
  return { assignmentId }
}
