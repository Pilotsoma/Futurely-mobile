// College catalog + prediction API — wraps the new backend ML endpoints.
//
// These are additive endpoints, independent from the saved-list endpoints in
// collegesApi.ts. The catalog is used for search typeahead; predict is called
// per-college when student stats are available.

import { apiGet, apiPost } from './client'

export interface CatalogCollege {
  id: number
  name: string
  avgSat: number
  avgAct: number
  avgGpa: number
  /** 0-1 decimal — multiply by 100 for display (e.g. 0.06 → "6%") */
  acceptanceRate: number
}

export type PredictTier = 'Safety' | 'Target' | 'Reach'

export interface PredictResponse {
  collegeName: string
  /** 0-100, e.g. 62.3 */
  probability: number
  tier: PredictTier
}

export interface PredictPayload {
  collegeId: number
  /** 400–1600 */
  studentSat: number
  /** 1–36, optional */
  studentAct?: number | null
  /** 0–5 */
  studentGpa: number
}

// GET /colleges/catalog?q=<string>&limit=<number>
// No auth required, but the client always sends one when available — that is fine.
export function getCollegeCatalog(
  q: string,
  token: string,
  limit?: number,
): Promise<CatalogCollege[]> {
  const params = new URLSearchParams({ q })
  if (limit !== undefined) params.set('limit', String(limit))
  return apiGet<CatalogCollege[]>(`/colleges/catalog?${params.toString()}`, token)
}

// POST /colleges/predict
// Requires auth. Returns tier ('Safety' | 'Target' | 'Reach') + probability (0-100).
// Callers must handle status 403 (COPPA block) and 503 (model unavailable) via
// the thrown ApiRequestError — the message field carries the server's message.
export function predictCollegeProbability(
  payload: PredictPayload,
  token: string,
): Promise<PredictResponse> {
  return apiPost<PredictResponse>('/colleges/predict', payload, token)
}

export interface CollegePathStep {
  type: 'quantitative' | 'qualitative'
  title: string
  description: string
  percentBoost: number
  source: 'model' | 'ai_estimate'
}

export interface CollegePathResponse {
  collegeName: string
  /** 0-100, e.g. 42.7 */
  baselineProbability: number
  /** Pre-sorted descending by percentBoost. May be empty (0 items is valid). */
  steps: CollegePathStep[]
}

// POST /colleges/path
// Requires auth. More expensive than /predict (calls model + Anthropic API).
// Rate limit: 10 req/min per IP — do NOT auto-fetch; only call on explicit user action.
// Callers must handle 403 (COPPA), 429 (rate limited), 503 (model down) via
// the thrown ApiRequestError — the message field carries the server's message.
export function predictCollegePath(
  payload: PredictPayload,
  token: string,
): Promise<CollegePathResponse> {
  return apiPost<CollegePathResponse>('/colleges/path', payload, token)
}
