import { apiFetch } from '../utils/api'

export interface Assignment {
  id: number
  userId: number
  title: string
  subject: string
  dueDate: string
  estimatedMinutes: number
  completed: boolean
  completedAt: string | null
  source: string
  createdAt: string
  updatedAt: string
}

interface ListAssignmentsResponse {
  data: Assignment[]
  meta: {
    nextCursor: number | null
    hasNextPage: boolean
    count: number
  }
}

interface ToggleCompleteResponse {
  data: Assignment
}

export async function fetchAssignments(): Promise<Assignment[]> {
  const res = await apiFetch<ListAssignmentsResponse>('/assignments')
  return res.data
}

export async function toggleAssignmentComplete(
  id: number,
  completed: boolean,
): Promise<Assignment> {
  const res = await apiFetch<ToggleCompleteResponse>(`/assignments/${id}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({ completed }),
  })
  return res.data
}
