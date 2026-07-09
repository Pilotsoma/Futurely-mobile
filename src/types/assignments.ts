export type AssignmentStatusFilter = 'incomplete' | 'complete' | 'all'

export interface Assignment {
  id: number
  userId: number
  title: string
  subject: string
  dueDate: string
  dueTime: string | null
  estimatedMinutes: number | null
  completed: boolean
  completedAt: string | null
  source: string
  priority: string | null
  createdAt: string
  updatedAt: string
}

export interface ListAssignmentsMeta {
  nextCursor: number | null
  hasNextPage: boolean
  count: number
}

export interface ListAssignmentsParams {
  status?: AssignmentStatusFilter
  cursor?: number
  limit?: number
}

export interface CreateAssignmentRequest {
  title: string
  subject?: string
  dueDate: string // "YYYY-MM-DD"
  dueTime?: string // "HH:MM", defaults server-side to "23:59"
}
