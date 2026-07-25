/**
 * Pure, stateless scoring service for college admission likelihood.
 *
 * Implements a logistic regression anchored to the college's known admission rate,
 * adjusted by how the student's SAT and GPA compare to the enrolled population.
 *
 * Score label thresholds mirror the existing client-side scoreLabel() function in
 * app/(app)/colleges/page.tsx so that label strings are consistent throughout the app.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Admission-rate clamp range to prevent logit from reaching ±Infinity. */
const ADMISSION_RATE_MIN = 0.01
const ADMISSION_RATE_MAX = 0.99

/** SAT logistic regression coefficient. */
const SAT_COEFFICIENT = 0.8

/** GPA logistic regression coefficient. */
const GPA_COEFFICIENT = 0.5

/**
 * Population mean and standard deviation used to z-score the student's GPA.
 * 3.5 / 0.4 approximates the national college-applicant distribution.
 */
const GPA_POPULATION_MEAN = 3.5
const GPA_POPULATION_SD = 0.4

/** Output score is clamped to [SCORE_MIN, SCORE_MAX] to keep it finite and displayable. */
const SCORE_MIN = 1
const SCORE_MAX = 98

/** Score label thresholds — must match scoreLabel() in app/(app)/colleges/page.tsx. */
const LABEL_LIKELY_THRESHOLD = 75
const LABEL_POSSIBLE_THRESHOLD = 50
const LABEL_REACH_THRESHOLD = 25

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScoreLabel = 'Likely' | 'Possible' | 'Reach' | 'Far Reach'

export interface ScoringInput {
  studentSAT: number | null
  studentGPA: number | null
  college: {
    admissionRate: number | null
    sat25th: number | null
    sat75th: number | null
  }
}

export interface ScoringResult {
  score: number | null
  label: ScoreLabel | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveLabel(score: number): ScoreLabel {
  if (score >= LABEL_LIKELY_THRESHOLD) return 'Likely'
  if (score >= LABEL_POSSIBLE_THRESHOLD) return 'Possible'
  if (score >= LABEL_REACH_THRESHOLD) return 'Reach'
  return 'Far Reach'
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the admission likelihood score and label for a student / college pair.
 *
 * Returns `{ score: null, label: null }` when:
 * - `admissionRate` is null (the logit intercept is undefined without it), or
 * - neither `studentSAT` nor `studentGPA` is available (no student signal).
 *
 * The score is an integer on [1, 98] representing the estimated admission
 * probability as a percentage, clamped away from the extremes to avoid the
 * false certainty of 0 and 100.
 */
export function computeLikelihoodScore(input: ScoringInput): ScoringResult {
  const { studentSAT, studentGPA, college } = input

  if (college.admissionRate === null) {
    return { score: null, label: null }
  }

  // Logit intercept anchored to the college's known admission rate.
  const clampedRate = Math.max(ADMISSION_RATE_MIN, Math.min(ADMISSION_RATE_MAX, college.admissionRate))
  const beta0 = Math.log(clampedRate / (1 - clampedRate))

  // ── SAT term ──────────────────────────────────────────────────────────────
  let satTerm = 0
  let hasSATTerm = false

  if (college.sat25th !== null && college.sat75th !== null && studentSAT !== null) {
    const satMidpoint = (college.sat25th + college.sat75th) / 2
    const satHalfIQR = (college.sat75th - college.sat25th) / 2

    // If the IQR is zero the band carries no signal — treat SAT as absent.
    if (satHalfIQR > 0) {
      const zSAT = (studentSAT - satMidpoint) / satHalfIQR
      satTerm = SAT_COEFFICIENT * zSAT
      hasSATTerm = true
    }
  }

  // ── GPA term ──────────────────────────────────────────────────────────────
  let gpaTerm = 0
  let hasGPATerm = false

  if (studentGPA !== null) {
    const zGPA = (studentGPA - GPA_POPULATION_MEAN) / GPA_POPULATION_SD
    gpaTerm = GPA_COEFFICIENT * zGPA
    hasGPATerm = true
  }

  // If neither student statistic is available, we cannot personalise the score.
  if (!hasSATTerm && !hasGPATerm) {
    return { score: null, label: null }
  }

  const linearPredictor = beta0 + satTerm + gpaTerm
  const probability = 1 / (1 + Math.exp(-linearPredictor))
  const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(probability * 100)))
  const label = deriveLabel(score)

  return { score, label }
}
