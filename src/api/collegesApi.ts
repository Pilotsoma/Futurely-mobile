// Colleges API — wraps /api/colleges endpoints (search, saved list, insights).
//
// Endpoint shapes confirmed from backend/src/routes/colleges.ts. Search and the
// saved list both return a personalised likelihood score/label computed
// server-side from the authenticated student's own SAT/GPA — callers never
// need to send those stats themselves.

import { apiGet, apiPost, apiDelete } from './client'

export interface CollegeListItem {
  id: number
  name: string
  scorecardUnitId: string | null
  createdAt: string
  unitId: string | null
  city: string | null
  state: string | null
  admissionRate: number | null
  sat25th: number | null
  sat75th: number | null
  score: number | null
  label: string | null
}

export interface CollegeSearchResult {
  unitId: string
  name: string
  city: string | null
  state: string | null
  admissionRate: number | null
  sat25th: number | null
  sat75th: number | null
  score: number | null
  label: string | null
}

export interface CollegeInsightsStep {
  step: string
  category: 'test' | 'gpa' | 'essay' | 'extracurricular' | 'strategy'
  priority: 'high' | 'medium' | 'low'
}

export interface CollegeInsights {
  collegeListItemId: number
  collegeName: string
  score: number | null
  label: 'Likely' | 'Possible' | 'Reach' | 'Far Reach' | null
  narrativeSummary: string
  actionableSteps: CollegeInsightsStep[]
  generatedAt: string
  cached: boolean
}

// GET /colleges — the current user's saved college list.
export function listColleges(token: string): Promise<CollegeListItem[]> {
  return apiGet<CollegeListItem[]>('/colleges', token)
}

// GET /colleges/search?q=<string> — search the College Scorecard catalog.
export function searchColleges(q: string, token: string): Promise<CollegeSearchResult[]> {
  return apiGet<CollegeSearchResult[]>(`/colleges/search?q=${encodeURIComponent(q)}`, token)
}

// POST /colleges — add a college to the list by name (+ optional scorecardUnitId).
export function addCollege(name: string, token: string, scorecardUnitId?: string): Promise<CollegeListItem> {
  return apiPost<CollegeListItem>('/colleges', { name, ...(scorecardUnitId ? { scorecardUnitId } : {}) }, token)
}

// DELETE /colleges/:id — remove a college from the list.
export function removeCollege(id: number, token: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/colleges/${id}`, undefined, token)
}

// GET /colleges/:id/insights — AI-generated admission insights for a saved college.
// Callers must handle 404 (no admissions data) and 503 (AI generation failed,
// no cache) via the thrown ApiRequestError's `status` field.
export function getCollegeInsights(id: number, token: string): Promise<CollegeInsights> {
  return apiGet<CollegeInsights>(`/colleges/${id}/insights`, token)
}
