// Schools directory API — wraps /api/schools/* endpoints.
//
// Endpoint shape confirmed from backend/src/routes/schools.ts. Public — no auth required.

import { apiGet } from './client'

export interface SchoolSearchResult {
  name: string
  district?: string
  city?: string
  state?: string
  [key: string]: unknown
}

// GET /schools/search?q=... — public school/district directory search.
export function searchSchools(query: string): Promise<SchoolSearchResult[]> {
  return apiGet<SchoolSearchResult[]>(`/schools/search?q=${encodeURIComponent(query)}`)
}
