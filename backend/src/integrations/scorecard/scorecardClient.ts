import axios, { AxiosError } from 'axios'
import { logger } from '../../common/logger'

// ── Constants ────────────────────────────────────────────────────────────────

const SCORECARD_BASE_URL = 'https://api.data.gov/ed/collegescorecard/v1/schools'

const SCORECARD_FIELDS = [
  'id',
  'school.name',
  'school.city',
  'school.state',
  'latest.admissions.admission_rate.overall',
  'latest.admissions.sat_scores.25th_percentile.critical_reading',
  'latest.admissions.sat_scores.25th_percentile.math',
  'latest.admissions.sat_scores.75th_percentile.critical_reading',
  'latest.admissions.sat_scores.75th_percentile.math',
  'latest.student.size',
].join(',')

const REQUEST_TIMEOUT_MS = 30_000
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const
// 100 is the College Scorecard API's maximum per_page. A wide pool is needed
// so that relevance ranking (see collegeSearchRanking.ts) has a real chance of
// finding the intended school — Scorecard's own substring match has no
// relevance ordering, so a well-known school can be buried past position 20.
const MAX_SEARCH_RESULTS = 100

// Errors that are safe to retry (network-layer failures and service unavailability).
// 429 (rate limit) is intentionally excluded — we return gracefully rather than
// hammering the API during a backoff window.
const RETRYABLE_STATUS_CODES = new Set([503])
const RETRYABLE_NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'])

// ── Public interface ─────────────────────────────────────────────────────────

/**
 * Normalized representation of a single school from the College Scorecard API.
 *
 * sat25th and sat75th are COMPOSITE scores (critical reading + math).
 * Either composite is null when either sub-field is missing from the API response.
 */
export interface ScorecardSchool {
  unitId: string
  name: string
  city: string | null
  state: string | null
  admissionRate: number | null
  sat25th: number | null
  sat75th: number | null
  enrollment: number | null
}

// ── Raw API response types ───────────────────────────────────────────────────

// The College Scorecard API returns fields as flat dot-notation keys matching
// the requested `fields` query param verbatim — it does NOT nest them into
// objects. e.g. `{"school.name": "MIT", "latest.admissions.admission_rate.overall": 0.04}`.
// Cohort-scoped fields (admissions, SAT, enrollment) require the `latest.` prefix
// or the API silently returns null for them; institution-level fields (school.*) don't.
interface RawSchoolResult {
  id: number
  'school.name': string
  'school.city': string | null
  'school.state': string | null
  'latest.admissions.admission_rate.overall': number | null
  'latest.admissions.sat_scores.25th_percentile.critical_reading': number | null
  'latest.admissions.sat_scores.25th_percentile.math': number | null
  'latest.admissions.sat_scores.75th_percentile.critical_reading': number | null
  'latest.admissions.sat_scores.75th_percentile.math': number | null
  'latest.student.size': number | null
}

interface ScorecardApiResponse {
  results: RawSchoolResult[]
  metadata: {
    total: number
    page: number
    per_page: number
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.COLLEGE_SCORECARD_API_KEY
  if (!key) {
    throw new Error('COLLEGE_SCORECARD_API_KEY environment variable is not set')
  }
  return key
}

function compositeScore(reading: number | null | undefined, math: number | null | undefined): number | null {
  if (reading === null || reading === undefined || math === null || math === undefined) {
    return null
  }
  return reading + math
}

function normalizeResult(raw: RawSchoolResult): ScorecardSchool {
  return {
    unitId: String(raw.id),
    name: raw['school.name'],
    city: raw['school.city'] ?? null,
    state: raw['school.state'] ?? null,
    admissionRate: raw['latest.admissions.admission_rate.overall'] ?? null,
    sat25th: compositeScore(
      raw['latest.admissions.sat_scores.25th_percentile.critical_reading'],
      raw['latest.admissions.sat_scores.25th_percentile.math']
    ),
    sat75th: compositeScore(
      raw['latest.admissions.sat_scores.75th_percentile.critical_reading'],
      raw['latest.admissions.sat_scores.75th_percentile.math']
    ),
    enrollment: raw['latest.student.size'] ?? null,
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof AxiosError) {
    if (err.code && RETRYABLE_NETWORK_CODES.has(err.code)) return true
    if (err.response && RETRYABLE_STATUS_CODES.has(err.response.status)) return true
  }
  return false
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromScorecard(params: Record<string, string | number>): Promise<ScorecardApiResponse | null> {
  const apiKey = getApiKey()

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await axios.get<ScorecardApiResponse>(SCORECARD_BASE_URL, {
        params: { ...params, api_key: apiKey, fields: SCORECARD_FIELDS },
        timeout: REQUEST_TIMEOUT_MS,
      })
      return response.data
    } catch (err) {
      if (err instanceof AxiosError) {
        const status = err.response?.status

        if (status === 429) {
          logger.warn('College Scorecard rate limit reached — returning graceful fallback', {
            params: { ...params, api_key: '[redacted]' },
          })
          return null
        }

        if (status === 404) {
          logger.info('College Scorecard returned 404 — no results', {
            params: { ...params, api_key: '[redacted]' },
          })
          return null
        }

        if (isRetryable(err) && attempt < RETRY_DELAYS_MS.length) {
          const delayMs = RETRY_DELAYS_MS[attempt]
          logger.warn('College Scorecard request failed — retrying', {
            attempt: attempt + 1,
            delayMs,
            errorCode: err.code ?? 'unknown',
            status,
          })
          await sleep(delayMs)
          continue
        }

        logger.error('College Scorecard request failed after retries', {
          errorCode: err.code ?? 'unknown',
          status,
          message: err.message,
        })
        return null
      }

      // Non-Axios error — log and bail
      const message = err instanceof Error ? err.message : 'unknown error'
      logger.error('Unexpected error calling College Scorecard API', { message })
      return null
    }
  }

  return null
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for schools by name using a case-insensitive partial match.
 * Returns up to 20 normalized results, or an empty array on any failure.
 */
export async function searchByName(query: string): Promise<ScorecardSchool[]> {
  logger.info('College Scorecard name search initiated', { queryLength: query.length })

  const response = await fetchFromScorecard({
    'school.name': query,
    per_page: MAX_SEARCH_RESULTS,
    page: 0,
  })

  if (!response || !Array.isArray(response.results)) {
    return []
  }

  const results = response.results.map(normalizeResult)
  logger.info('College Scorecard name search complete', { resultCount: results.length })
  return results
}

/**
 * Fetch a single school by its College Scorecard unit ID.
 * Returns the normalized school record, or null if not found or on any failure.
 */
export async function fetchByUnitId(unitId: string): Promise<ScorecardSchool | null> {
  logger.info('College Scorecard unit ID fetch initiated', { unitId })

  const response = await fetchFromScorecard({
    id: unitId,
    per_page: 1,
    page: 0,
  })

  if (!response || !Array.isArray(response.results) || response.results.length === 0) {
    logger.info('College Scorecard unit ID fetch returned no results', { unitId })
    return null
  }

  const result = normalizeResult(response.results[0])
  logger.info('College Scorecard unit ID fetch complete', { unitId })
  return result
}
