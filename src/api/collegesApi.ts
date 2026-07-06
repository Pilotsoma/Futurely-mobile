// Colleges API — wraps /api/colleges endpoints (student's saved college list).
//
// Endpoint shapes confirmed from backend/src/routes/colleges.ts.

import { apiGet, apiPost, apiDelete } from './client'

export interface CollegeListItem {
  id: number
  userId: number
  name: string
  createdAt: string
}

// GET /colleges — the current user's saved college list.
export function listColleges(token: string): Promise<CollegeListItem[]> {
  return apiGet<CollegeListItem[]>('/colleges', token)
}

// POST /colleges — add a college to the list by name.
export function addCollege(name: string, token: string): Promise<CollegeListItem> {
  return apiPost<CollegeListItem>('/colleges', { name }, token)
}

// DELETE /colleges/:id — remove a college from the list.
export function removeCollege(id: number, token: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/colleges/${id}`, undefined, token)
}
