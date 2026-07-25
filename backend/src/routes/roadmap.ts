import { Router, Response } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { writeAuditLog } from '../lib/auditLog'
import { generatePersonalizedMilestones, buildFallbackMilestones } from '../services/ai/roadmapInsights'
import { gatherRoadmapCore } from '../services/roadmap/roadmapCore.service'

const router = Router()

// Fast path: real structured data + instant (non-AI) milestones, so the page
// never blocks on an LLM call. The frontend fetches personalized milestones
// separately from GET /insights once the page has already rendered.
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userId === undefined) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    return
  }
  try {
    // FERPA: Course and Grade data are education records — audit every read.
    await writeAuditLog({
      userId: req.userId,
      resourceType: 'COURSE',
      resourceId: String(req.userId),
      action: 'READ_ROADMAP',
      ipAddress: req.ip ?? 'unknown',
    })

    const core = await gatherRoadmapCore(req.userId)

    res.json({
      data: {
        ...core,
        percentComplete: Math.round((core.creditsCompleted / core.creditsRequired) * 100),
        milestones: buildFallbackMilestones(core.gradeLevel),
      },
    })
  } catch {
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

// Slow path: the AI-personalized milestones, fetched separately so the main
// roadmap page load never waits on an LLM call.
router.get('/insights', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userId === undefined) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    return
  }
  try {
    await writeAuditLog({
      userId: req.userId,
      resourceType: 'COURSE',
      resourceId: String(req.userId),
      action: 'READ_ROADMAP',
      ipAddress: req.ip ?? 'unknown',
    })

    const core = await gatherRoadmapCore(req.userId)
    const milestones = await generatePersonalizedMilestones(core)

    res.json({ data: { milestones } })
  } catch {
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
})

export default router
