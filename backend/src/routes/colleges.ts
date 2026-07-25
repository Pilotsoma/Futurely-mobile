import { Router, Response } from 'express'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { logger } from '../common/logger'
import { writeAuditLog } from '../lib/auditLog'
import { searchByName, ScorecardSchool } from '../integrations/scorecard/scorecardClient'
import { computeLikelihoodScore } from '../services/collegeScoring'
import { rankSearchResults } from '../services/collegeSearchRanking'
import { getOrGenerateInsights } from '../services/collegeInsights'

const router = Router()

// ── Schemas ───────────────────────────────────────────────────────────────────

const addSchema = z.object({
  name: z.string().min(1).max(200),
  scorecardUnitId: z.string().optional(),
})

// ── Types ─────────────────────────────────────────────────────────────────────

/** Common shape shared by cached rows and freshly-fetched Scorecard results. */
interface SearchCandidate {
  unitId: string
  name: string
  city: string | null
  state: string | null
  admissionRate: number | null
  sat25th: number | null
  sat75th: number | null
  enrollment: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getIpAddress(req: AuthRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/**
 * Upsert a batch of Scorecard API results into the local cache.
 * Silently swallows individual upsert errors to avoid a single bad record
 * blocking the rest of the batch.
 */
async function upsertScorecardBatch(schools: ScorecardSchool[]): Promise<void> {
  await Promise.all(
    schools.map(school =>
      prisma.collegeScorecardCache.upsert({
        where: { unitId: school.unitId },
        update: {
          name: school.name,
          city: school.city,
          state: school.state,
          admissionRate: school.admissionRate,
          sat25th: school.sat25th,
          sat75th: school.sat75th,
          enrollment: school.enrollment,
          fetchedAt: new Date(),
        },
        create: {
          unitId: school.unitId,
          name: school.name,
          city: school.city,
          state: school.state,
          admissionRate: school.admissionRate,
          sat25th: school.sat25th,
          sat75th: school.sat75th,
          enrollment: school.enrollment,
        },
      }).catch((err: unknown) => {
        logger.warn('College Scorecard cache upsert failed for individual school', {
          unitId: school.unitId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    )
  )
}

/**
 * Fetch the student's SAT score and unweighted GPA from their Profile row.
 * Unweighted GPA is used because the logistic-regression formula is calibrated
 * to the standard 4.0 scale (mean 3.5, SD 0.4). A value of exactly 0 is treated
 * as absent because 0 is the Prisma default, not a real academic GPA.
 */
async function fetchStudentStats(userId: number): Promise<{ studentSAT: number | null; studentGPA: number | null }> {
  const profile = await prisma.profile.findUnique({ where: { userId } })
  return {
    studentSAT: profile?.satScore ?? null,
    studentGPA: profile?.unweightedGpa && profile.unweightedGpa > 0 ? profile.unweightedGpa : null,
  }
}

// ── GET /search?q=<query> ─────────────────────────────────────────────────────

/**
 * Search colleges by name. Returns up to 20 results enriched with a personalised
 * likelihood score derived from the authenticated student's SAT and GPA.
 *
 * Strategy:
 * 1. Query the local CollegeScorecardCache for fast results.
 * 2. If fewer than 5 cache hits, fetch from the College Scorecard API and upsert
 *    the results into the cache, then re-query.
 * 3. Attach per-college likelihood score and label.
 */
router.get('/search', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) {
    res.status(400).json({ data: null, error: { message: 'Query parameter q is required' } })
    return
  }

  try {
    // 1. Cache-first lookup. A wide pool (100) is fetched so relevance ranking
    // below has a real chance of surfacing the intended school — Scorecard's
    // substring match has no relevance ordering of its own.
    const cacheResults = await prisma.collegeScorecardCache.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      take: 100,
    })

    // Candidates are keyed by unitId so live API results (added below) can
    // overwrite/merge with cache rows without duplicates.
    const candidates = new Map<string, SearchCandidate>(cacheResults.map(c => [c.unitId, c]))

    // 2. Refresh from the live API if the cache is sparse. Scorecard's own name
    // filter can match schools that don't literally contain the query as a
    // substring (e.g. tokenized/fuzzy matching), so API results are merged in
    // directly rather than re-querying the cache with our own literal filter
    // — re-filtering would silently drop exactly the matches Scorecard found
    // that our own `contains` check doesn't recognise.
    if (cacheResults.length < 5) {
      logger.info('College search cache miss — fetching from Scorecard API', {
        userId,
        query: q,
        cacheHits: cacheResults.length,
      })
      const apiResults = await searchByName(q)
      if (apiResults.length > 0) {
        await upsertScorecardBatch(apiResults)
        for (const school of apiResults) {
          candidates.set(school.unitId, school)
        }
      }
    }

    // 3. Fetch student stats for personalised scoring
    const { studentSAT, studentGPA } = await fetchStudentStats(userId)

    await writeAuditLog({
      userId,
      resourceType: 'CollegeScorecardSearch',
      action: 'READ',
      ipAddress: getIpAddress(req),
    })

    const ranked = rankSearchResults(Array.from(candidates.values()), q).slice(0, 20)

    const data = ranked.map(c => ({
      unitId: c.unitId,
      name: c.name,
      city: c.city,
      state: c.state,
      admissionRate: c.admissionRate,
      sat25th: c.sat25th,
      sat75th: c.sat75th,
      ...computeLikelihoodScore({
        studentSAT,
        studentGPA,
        college: { admissionRate: c.admissionRate, sat25th: c.sat25th, sat75th: c.sat75th },
      }),
    }))

    res.json({ data })
  } catch (err) {
    logger.error('College search failed', {
      userId,
      query: q,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ data: null, error: { message: 'Internal server error' } })
  }
})

// ── GET / — saved college list ────────────────────────────────────────────────

/**
 * Return the authenticated user's saved college list, enriched with Scorecard
 * data and a personalised likelihood score.
 *
 * Legacy items (no scorecardUnitId):
 * - If a case-insensitive exact name match exists in the cache → backfill
 *   scorecardUnitId and use the cached data.
 * - If no cache hit → fire-and-forget a background search to warm the cache
 *   for the next request; return score: null for this item in the current response.
 */
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!

  try {
    const items = await prisma.collegeListItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { scorecardData: true },
    })

    const { studentSAT, studentGPA } = await fetchStudentStats(userId)

    await writeAuditLog({
      userId,
      resourceType: 'CollegeList',
      action: 'READ',
      ipAddress: getIpAddress(req),
    })

    const data = await Promise.all(
      items.map(async item => {
        let scorecardData = item.scorecardData

        if (scorecardData === null) {
          // Legacy item: attempt a case-insensitive exact name match from the cache
          const cacheHit = await prisma.collegeScorecardCache.findFirst({
            where: { name: { equals: item.name, mode: 'insensitive' } },
          })

          if (cacheHit !== null) {
            // Backfill so future requests skip this lookup
            await prisma.collegeListItem.update({
              where: { id: item.id },
              data: { scorecardUnitId: cacheHit.unitId },
            }).catch((err: unknown) => {
              logger.warn('Failed to backfill scorecardUnitId on legacy college list item', {
                itemId: item.id,
                error: err instanceof Error ? err.message : String(err),
              })
            })
            scorecardData = cacheHit
          } else {
            // No cache hit — warm the cache asynchronously; don't block this response
            void searchByName(item.name)
              .then(results => upsertScorecardBatch(results))
              .catch((err: unknown) => {
                logger.warn('Background cache warming for legacy college list item failed', {
                  collegeName: item.name,
                  error: err instanceof Error ? err.message : String(err),
                })
              })
          }
        }

        const scoring = scorecardData !== null
          ? computeLikelihoodScore({
              studentSAT,
              studentGPA,
              college: {
                admissionRate: scorecardData.admissionRate,
                sat25th: scorecardData.sat25th,
                sat75th: scorecardData.sat75th,
              },
            })
          : { score: null, label: null }

        return {
          id: item.id,
          name: item.name,
          scorecardUnitId: item.scorecardUnitId,
          createdAt: item.createdAt,
          unitId: scorecardData?.unitId ?? null,
          city: scorecardData?.city ?? null,
          state: scorecardData?.state ?? null,
          admissionRate: scorecardData?.admissionRate ?? null,
          sat25th: scorecardData?.sat25th ?? null,
          sat75th: scorecardData?.sat75th ?? null,
          score: scoring.score,
          label: scoring.label,
        }
      })
    )

    res.json({ data })
  } catch (err) {
    logger.error('College list fetch failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ data: null, error: { message: 'Internal server error' } })
  }
})

// ── POST / — add college to list ──────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!
  const parse = addSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ data: null, error: { message: parse.error.errors[0]?.message ?? 'Invalid request' } })
    return
  }
  try {
    const item = await prisma.collegeListItem.create({
      data: {
        userId,
        name: parse.data.name,
        scorecardUnitId: parse.data.scorecardUnitId ?? null,
      },
      include: { scorecardData: true },
    })

    const { studentSAT, studentGPA } = await fetchStudentStats(userId)

    const scoring = item.scorecardData !== null
      ? computeLikelihoodScore({
          studentSAT,
          studentGPA,
          college: {
            admissionRate: item.scorecardData.admissionRate,
            sat25th: item.scorecardData.sat25th,
            sat75th: item.scorecardData.sat75th,
          },
        })
      : { score: null, label: null }

    res.json({
      data: {
        id: item.id,
        name: item.name,
        scorecardUnitId: item.scorecardUnitId,
        createdAt: item.createdAt,
        unitId: item.scorecardData?.unitId ?? null,
        city: item.scorecardData?.city ?? null,
        state: item.scorecardData?.state ?? null,
        admissionRate: item.scorecardData?.admissionRate ?? null,
        sat25th: item.scorecardData?.sat25th ?? null,
        sat75th: item.scorecardData?.sat75th ?? null,
        score: scoring.score,
        label: scoring.label,
      },
    })
  } catch {
    res.status(409).json({ data: null, error: { message: 'College already in your list' } })
  }
})

// ── GET /:id/insights — college admission insights ────────────────────────────

/**
 * Return AI-generated admission insights for a single saved college.
 * Insights are cached server-side; the cache TTL is controlled by the
 * COLLEGE_INSIGHTS_MAX_CACHE_AGE_DAYS environment variable (default: 90 days).
 *
 * 400  — id is not a valid integer
 * 404  — item not found or admissions data unavailable
 * 503  — AI generation failed and no cached result exists
 */
router.get('/:id/insights', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { message: 'Invalid id' } })
    return
  }

  const userId = req.userId!

  try {
    const item = await prisma.collegeListItem.findFirst({
      where: { id, userId },
      include: { scorecardData: true },
    })

    if (item === null) {
      await writeAuditLog({
        userId,
        resourceType: 'CollegeInsights',
        resourceId: String(id),
        action: 'READ',
        ipAddress: getIpAddress(req),
      })
      res.status(404).json({ data: null, error: { message: 'College not found' } })
      return
    }

    if (item.scorecardData === null || item.scorecardData.admissionRate === null) {
      await writeAuditLog({
        userId,
        resourceType: 'CollegeInsights',
        resourceId: String(item.id),
        action: 'READ',
        ipAddress: getIpAddress(req),
      })
      res.status(404).json({
        data: null,
        error: { message: 'Insights unavailable — admissions data not found for this college.' },
      })
      return
    }

    const { studentSAT, studentGPA } = await fetchStudentStats(userId)

    const scoringInput = {
      studentSAT,
      studentGPA,
      college: {
        admissionRate: item.scorecardData.admissionRate,
        sat25th: item.scorecardData.sat25th,
        sat75th: item.scorecardData.sat75th,
      },
    }

    const result = await getOrGenerateInsights({
      collegeListItemId: item.id,
      userId,
      collegeName: item.name,
      scoringInput,
      admissionRate: item.scorecardData.admissionRate,
      ipAddress: getIpAddress(req),
    })

    if (result === null) {
      res.status(503).json({ data: null, error: { message: 'Insights temporarily unavailable' } })
      return
    }

    const { score, label } = computeLikelihoodScore(scoringInput)

    res.json({
      data: {
        collegeListItemId: item.id,
        collegeName: item.name,
        score,
        label,
        narrativeSummary: result.narrativeSummary,
        actionableSteps: result.actionableSteps,
        generatedAt: result.generatedAt.toISOString(),
        cached: result.cached,
      },
    })
  } catch (err) {
    logger.error('College insights request failed', {
      collegeListItemId: id,
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ data: null, error: { message: 'Internal server error' } })
  }
})

// ── DELETE /:id ───────────────────────────────────────────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ data: null, error: { message: 'Invalid id' } })
    return
  }
  await prisma.collegeListItem.deleteMany({ where: { id, userId } })
  res.json({ data: { deleted: true } })
})

export default router
