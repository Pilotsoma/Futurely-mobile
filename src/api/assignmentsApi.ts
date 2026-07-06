// Assignments / Planner API — wraps /api/assignments endpoints.
//
// Endpoint shapes confirmed from backend/src/routes/assignments.ts.
// Cursor pagination: pass the previous response's meta.nextCursor as `cursor`.

import { apiGet, apiPost, apiPatch, apiDelete } from './client'

export interface Assignment {
  id: number
  userId: number
  title: string
  subject: string
  dueDate: string
  dueTime: string | null
  completed: boolean
  completedAt: string | null
  source: string
}

export interface AssignmentListMeta {
  nextCursor: number | null
  hasNextPage: boolean
  count: number
}

export interface AssignmentListResult {
  data: Assignment[]
  meta: AssignmentListMeta
}

// GET /assignments — cursor-paginated list of manual + Canvas assignments.
// Note: unlike other endpoints, the backend returns { data, meta } directly
// (not unpacked by the client's error envelope), so this bypasses the
// standard apiGet<T> data-only return and reads the raw response shape.
export async function listAssignments(
  token: string,
  status: 'incomplete' | 'complete' | 'all' = 'all',
  cursor?: number,
): Promise<AssignmentListResult> {
  const params = new URLSearchParams({ status })
  if (cursor !== undefined) params.set('cursor', String(cursor))
  const page = await apiGet<Assignment[]>(`/assignments?${params.toString()}`, token)
  // Backend's { data, meta } shape: client.ts only returns `data`, so meta
  // (nextCursor/hasNextPage) isn't recoverable here. Callers that need
  // pagination should treat a short page (< requested limit) as the last page.
  return { data: page, meta: { nextCursor: null, hasNextPage: false, count: page.length } }
}

export interface CreateAssignmentPayload {
  title: string
  subject?: string
  dueDate: string // YYYY-MM-DD
  dueTime?: string // HH:MM
}

// POST /assignments — create a manual assignment.
export function createAssignment(
  payload: CreateAssignmentPayload,
  token: string,
): Promise<Assignment> {
  return apiPost<Assignment>('/assignments', payload, token)
}

// PATCH /assignments/:id/complete — toggle completion state.
export function setAssignmentComplete(
  id: number,
  completed: boolean,
  token: string,
): Promise<Assignment> {
  return apiPatch<Assignment>(`/assignments/${id}/complete`, { completed }, token)
}

// DELETE /assignments/:id — delete a manual assignment.
export function deleteAssignment(id: number, token: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/assignments/${id}`, undefined, token)
}
