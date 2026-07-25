import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { logger } from '../common/logger'
import { writeAuditLog } from '../lib/auditLog'
import { computeLikelihoodScore, type ScoringInput } from './collegeScoring'
import { generateCollegeInsights } from './ai/collegeInsightsPrompt'
import { getPortalData, deriveGradeLevel, countRigorousCourses } from '../lib/studentContext'
import type {
  ActionableStep,
  CollegeInsightsPromptInput,
  GpaPosition,
  SatPosition,
} from '../types/collegeInsights'

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CACHE_AGE_DAYS = 90

/** Population constants mirroring collegeScoring.ts */
const GPA_POPULATION_MEAN = 3.5
const GPA_POPULATION_SD = 0.4

/** SAT position threshold in points relative to sat25th. */
const SAT_WELL_BELOW_THRESHOLD = 100

// ── Types ─────────────────────────────────────────────────────────────────────

interface GetOrGenerateParams {
  collegeListItemId: number
  userId: number
  collegeName: string
  scoringInput: ScoringInput
  admissionRate: number
  ipAddress: string
}

interface InsightsResult {
  narrativeSummary: string
  actionableSteps: ActionableStep[]
  generatedAt: Date
  cached: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hex digest over a canonically serialised representation of
 * the inputs that determine the generated insights content.  All keys are sorted
 * alphabetically; null values are encoded as the literal string "null" so that
 * JSON.stringify does not silently drop them.
 */
function buildInputHash(params: {
  admissionRate: number
  gpa: number | null
  sat25th: number | null
  sat75th: number | null
  satScore: number | null
  courseList: string[]
  classRank: string | null
  attendanceSummary: string | null
}): string {
  const canonical = JSON.stringify(
    {
      admissionRate: params.admissionRate,
      gpa: params.gpa ?? 'null',
      sat25th: params.sat25th ?? 'null',
      sat75th: params.sat75th ?? 'null',
      satScore: params.satScore ?? 'null',
      courseList: params.courseList,
      classRank: params.classRank ?? 'null',
      attendanceSummary: params.attendanceSummary ?? 'null',
    },
    Object.keys({
      admissionRate: true,
      gpa: true,
      sat25th: true,
      sat75th: true,
      satScore: true,
      courseList: true,
      classRank: true,
      attendanceSummary: true,
    }).sort()
  )
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

/**
 * Determine where the student's SAT score falls relative to the college band.
 * Returns 'not_provided' when any of the three values needed is absent.
 */
function buildSatPosition(
  studentSAT: number | null,
  sat25th: number | null,
  sat75th: number | null
): { position: SatPosition; deltaFrom25th: number | null } {
  if (studentSAT === null || sat25th === null || sat75th === null) {
    return { position: 'not_provided', deltaFrom25th: null }
  }

  const delta = studentSAT - sat25th

  if (studentSAT < sat25th - SAT_WELL_BELOW_THRESHOLD) {
    return { position: 'well_below_25th', deltaFrom25th: delta }
  }
  if (studentSAT < sat25th) {
    return { position: 'below_25th', deltaFrom25th: delta }
  }
  if (studentSAT <= sat75th) {
    return { position: 'in_band', deltaFrom25th: delta }
  }
  return { position: 'above_75th', deltaFrom25th: delta }
}

/**
 * Determine where the student's GPA falls relative to the applicant population.
 * Uses the same z-score formula as collegeScoring.ts (mean 3.5, SD 0.4).
 */
function buildGpaPosition(gpa: number | null): { position: GpaPosition; zScore: number | null } {
  if (gpa === null) {
    return { position: 'not_provided', zScore: null }
  }

  const z = (gpa - GPA_POPULATION_MEAN) / GPA_POPULATION_SD

  if (z < -1) return { position: 'well_below_mean', zScore: z }
  if (z < 0) return { position: 'below_mean', zScore: z }
  if (z < 1) return { position: 'at_mean', zScore: z }
  return { position: 'above_mean', zScore: z }
}

/**
 * Return the configured maximum cache age in days, falling back to the default
 * when the env var is missing or non-numeric.
 */
function maxCacheAgeDays(): number {
  const raw = process.env.COLLEGE_INSIGHTS_MAX_CACHE_AGE_DAYS
  if (raw === undefined || raw === '') return DEFAULT_CACHE_AGE_DAYS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_AGE_DAYS
}

function isCacheStale(generatedAt: Date): boolean {
  const ageMs = Date.now() - generatedAt.getTime()
  const maxAgeMs = maxCacheAgeDays() * 24 * 60 * 60 * 1000
  return ageMs > maxAgeMs
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return cached or freshly generated college admission insights for the given
 * student / college pair.
 *
 * Returns null when no cached data exists AND the AI generation fails, so the
 * caller can surface a 503 response rather than a generic 500.
 */
export async function getOrGenerateInsights(
  params: GetOrGenerateParams
): Promise<InsightsResult | null> {
  const { collegeListItemId, userId, collegeName, scoringInput, admissionRate, ipAddress } = params

  // Always write the audit log regardless of cache status (FERPA requirement).
  const auditPromise = writeAuditLog({
    userId,
    resourceType: 'CollegeInsights',
    resourceId: String(collegeListItemId),
    action: 'READ',
    ipAddress,
  })

  const [profile, portalData] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    getPortalData(userId),
  ])
  const courseList = portalData?.courseList ?? []
  const classRank = portalData?.classRank ?? null
  const attendanceSummary = portalData?.attendanceSummary || null
  const gradeLevel = deriveGradeLevel(profile?.graduationYear ?? null, profile?.gradeLevel ?? null)

  const inputHash = buildInputHash({
    admissionRate,
    gpa: scoringInput.studentGPA,
    sat25th: scoringInput.college.sat25th,
    sat75th: scoringInput.college.sat75th,
    satScore: scoringInput.studentSAT,
    courseList,
    classRank,
    attendanceSummary,
  })

  try {
    const cached = await prisma.collegeInsightsCache.findUnique({
      where: { collegeListItemId },
    })

    // ── Cache hit: hash matches and not stale ─────────────────────────────────
    if (cached !== null && cached.inputHash === inputHash && !isCacheStale(cached.generatedAt)) {
      logger.info('College insights cache hit', { collegeListItemId, userId })
      await auditPromise
      return {
        narrativeSummary: cached.narrativeSummary,
        actionableSteps: (cached.actionableSteps as unknown) as ActionableStep[],
        generatedAt: cached.generatedAt,
        cached: true,
      }
    }

    // ── Cache miss or stale: generate fresh insights ──────────────────────────
    logger.info('College insights cache miss — generating', {
      collegeListItemId,
      userId,
      hashMatch: cached !== null ? cached.inputHash === inputHash : false,
      stale: cached !== null ? isCacheStale(cached.generatedAt) : false,
    })

    const scoringResult = computeLikelihoodScore(scoringInput)
    const { position: satPosition, deltaFrom25th: satDeltaFrom25th } = buildSatPosition(
      scoringInput.studentSAT,
      scoringInput.college.sat25th,
      scoringInput.college.sat75th
    )
    const { position: gpaPosition, zScore: gpaZScore } = buildGpaPosition(scoringInput.studentGPA)

    // score and label are guaranteed non-null when this service is called from
    // the route (which already checks admissionRate !== null and has at least
    // one student stat), but we build the prompt input conditionally to satisfy
    // the type constraint — fall back to 50/'Possible' if scoring returns null.
    const promptInput: CollegeInsightsPromptInput = {
      collegeName,
      score: scoringResult.score ?? 50,
      label: scoringResult.label ?? 'Possible',
      admissionRate,
      sat25th: scoringInput.college.sat25th,
      sat75th: scoringInput.college.sat75th,
      satPosition,
      satDeltaFrom25th,
      gpaPosition,
      gpaZScore,
      gradeLevel,
      courseList,
      rigorousCourseCount: countRigorousCourses(courseList),
      classRank,
      attendanceSummary,
    }

    let payload
    try {
      payload = await generateCollegeInsights(promptInput)
    } catch (aiError) {
      logger.warn('College insights generation failed', {
        collegeListItemId,
        userId,
        error: aiError instanceof Error ? aiError.message : String(aiError),
      })

      // Fall back to stale cached data if it exists rather than hard-failing.
      if (cached !== null) {
        logger.warn('College insights: returning stale cached result after AI failure', {
          collegeListItemId,
          userId,
        })
        await auditPromise
        return {
          narrativeSummary: cached.narrativeSummary,
          actionableSteps: (cached.actionableSteps as unknown) as ActionableStep[],
          generatedAt: cached.generatedAt,
          cached: true,
        }
      }

      await auditPromise
      return null
    }

    // Upsert the freshly generated insights into the cache.
    const upserted = await prisma.collegeInsightsCache.upsert({
      where: { collegeListItemId },
      create: {
        collegeListItemId,
        userId,
        inputHash,
        narrativeSummary: payload.narrativeSummary,
        actionableSteps: payload.actionableSteps as unknown as Prisma.InputJsonValue,
      },
      update: {
        userId,
        inputHash,
        narrativeSummary: payload.narrativeSummary,
        actionableSteps: payload.actionableSteps as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    })

    await auditPromise
    return {
      narrativeSummary: upserted.narrativeSummary,
      actionableSteps: (upserted.actionableSteps as unknown) as ActionableStep[],
      generatedAt: upserted.generatedAt,
      cached: false,
    }
  } catch (err) {
    logger.error('College insights service error', {
      collegeListItemId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    // Ensure audit log is still attempted even on unexpected errors.
    await auditPromise.catch(() => undefined)
    throw err
  }
}
