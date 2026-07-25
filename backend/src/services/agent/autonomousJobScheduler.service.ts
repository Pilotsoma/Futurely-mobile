/**
 * AutonomousJobSchedulerService — enqueues and processes AutonomousAgentJob rows.
 *
 * Guardrails:
 * - All execution is gated by AUTONOMOUS_AGENTS_ENABLED=true env var.
 *   If unset or false, enqueueJobs() is a no-op and worker skips all jobs.
 * - Write tools are never dispatched in SYSTEM sessions — enforced by
 *   AgentExecutionService.dispatchTool before any tool runs.
 * - No PII in worker log lines — userId references only.
 * - COPPA check happens inside AgentExecutionService.startSession.
 *
 * Scheduling pattern:
 * - A setInterval (started from index.ts) polls for pending jobs every minute.
 * - Jobs are enqueued once per day by enqueueJobs() (also called from
 *   index.ts after server start, and scheduled at midnight UTC via
 *   the same interval by checking the current hour).
 */

import { prisma } from '../../lib/prisma'
import { logger } from '../../common/logger'
import { startSession, completeSession } from './agentExecution.service'
import { runGpaCheckin } from '../gpaCheckin.service'

// PROACTIVE_PLANNER_NUDGE was removed — it would have duplicated the
// existing free, deterministic assignment-due-soon reminder cron
// (checkAndSendReminders / assignmentReminder.service.ts), which already
// covers "tell the student about upcoming work" without any AI cost.
// processJob() below still recognizes the old string value defensively, in
// case any PENDING rows already exist in the DB from before this change.
export type JobTriggerType = 'NIGHTLY_GPA_CHECKIN'

const WORKER_BATCH_SIZE = 20
const SYSTEM_IP = 'scheduler'

// ── Job enqueueing ────────────────────────────────────────────────────────────

/**
 * Enqueues autonomous jobs for all eligible users if they haven't been
 * scheduled already for today's window.
 *
 * Eligible users: autonomousConsentAcceptedAt IS NOT NULL.
 * COPPA check: handled by AgentExecutionService when the job executes.
 *
 * Called at server startup and whenever the scheduler checks the hour.
 */
export async function enqueueJobsForToday(): Promise<void> {
  if (process.env.AUTONOMOUS_AGENTS_ENABLED !== 'true') {
    logger.info('autonomous_scheduler_flag_off', { action: 'enqueue_skipped' })
    return
  }

  const now = new Date()
  const todayMidnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // Find eligible users (opted in to autonomous features)
  const eligibleUsers = await prisma.user.findMany({
    where: { autonomousConsentAcceptedAt: { not: null }, deletedAt: null },
    select: { id: true },
  })

  if (eligibleUsers.length === 0) {
    logger.info('autonomous_enqueue_no_eligible_users', { date: todayMidnightUtc.toISOString() })
    return
  }

  const jobsToCreate: Array<{
    userId: number
    module: string
    triggerType: JobTriggerType
    scheduledAt: Date
  }> = []

  for (const user of eligibleUsers) {
    // Check if today's NIGHTLY_GPA_CHECKIN already exists for this user
    const existingNightly = await prisma.autonomousAgentJob.findFirst({
      where: {
        userId: user.id,
        triggerType: 'NIGHTLY_GPA_CHECKIN',
        scheduledAt: { gte: todayMidnightUtc },
      },
      select: { id: true },
    })

    if (existingNightly === null) {
      jobsToCreate.push({
        userId: user.id,
        module: 'GPA',
        triggerType: 'NIGHTLY_GPA_CHECKIN',
        scheduledAt: todayMidnightUtc,
      })
    }
  }

  if (jobsToCreate.length === 0) {
    logger.info('autonomous_enqueue_already_done', {
      date: todayMidnightUtc.toISOString(),
      userCount: eligibleUsers.length,
    })
    return
  }

  await prisma.autonomousAgentJob.createMany({ data: jobsToCreate })

  logger.info('autonomous_enqueue_complete', {
    jobsCreated: jobsToCreate.length,
    userCount: eligibleUsers.length,
  })
}

// ── Job processing worker ─────────────────────────────────────────────────────

let isWorkerRunning = false

/**
 * Processes pending autonomous jobs in batches of 20.
 * Guards against concurrent execution with an in-process flag.
 *
 * No PII in log lines. Job IDs and status codes only.
 */
async function processPendingBatch(): Promise<number> {
  const now = new Date()
  const pendingJobs = await prisma.autonomousAgentJob.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: WORKER_BATCH_SIZE,
    select: {
      id: true,
      userId: true,
      module: true,
      triggerType: true,
    },
  })

  if (pendingJobs.length === 0) return 0

  logger.info('autonomous_worker_processing', { batchSize: pendingJobs.length })

  for (const job of pendingJobs) {
    await processJob(job.id, job.userId, job.module, job.triggerType)
  }

  return pendingJobs.length
}

/**
 * Processes one batch (up to WORKER_BATCH_SIZE) of pending jobs.
 * Used by the local-dev setInterval loop (startScheduler) — not called in
 * production, where the interval doesn't survive Vercel's per-request
 * invocation model. See drainPendingJobs() for the production path.
 */
export async function runWorkerBatch(): Promise<void> {
  if (process.env.AUTONOMOUS_AGENTS_ENABLED !== 'true') {
    return
  }

  if (isWorkerRunning) {
    logger.info('autonomous_worker_already_running', {})
    return
  }

  isWorkerRunning = true
  try {
    await processPendingBatch()
  } catch (err) {
    logger.error('autonomous_worker_batch_error', {
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    isWorkerRunning = false
  }
}

/**
 * Enqueues today's jobs (if not already done) and processes pending jobs to
 * completion within this single call, up to maxBatches batches. Designed for
 * a serverless request/response lifecycle (no persistent worker to keep
 * picking up leftover work later) — call this from a cron-triggered HTTP
 * endpoint, not a setInterval.
 */
export async function runDailyCheckins(maxBatches = 25): Promise<{ batchesRun: number; jobsProcessed: number }> {
  if (process.env.AUTONOMOUS_AGENTS_ENABLED !== 'true') {
    return { batchesRun: 0, jobsProcessed: 0 }
  }

  await enqueueJobsForToday()

  let batchesRun = 0
  let jobsProcessed = 0

  while (batchesRun < maxBatches) {
    const count = await processPendingBatch()
    batchesRun++
    jobsProcessed += count
    if (count < WORKER_BATCH_SIZE) break // fewer than a full batch means the queue is drained
  }

  return { batchesRun, jobsProcessed }
}

async function processJob(
  jobId: number,
  userId: number | null,
  module: string,
  triggerType: string,
): Promise<void> {
  // Mark job as RUNNING
  await prisma.autonomousAgentJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', executedAt: new Date() },
  })

  try {
    // Skip jobs with no userId (shouldn't happen with current enqueue logic,
    // but guard defensively)
    if (userId === null) {
      await prisma.autonomousAgentJob.update({
        where: { id: jobId },
        data: { status: 'SKIPPED_FLAG_OFF', result: { reason: 'no_user_id' } },
      })
      return
    }

    // PROACTIVE_PLANNER_NUDGE was removed (duplicated the existing free
    // assignment-reminder cron) — this only fires for rows enqueued before
    // that change that are still PENDING.
    if (triggerType === 'PROACTIVE_PLANNER_NUDGE') {
      await prisma.autonomousAgentJob.update({
        where: { id: jobId },
        data: { status: 'SKIPPED_FLAG_OFF', result: { reason: 'trigger_removed' } },
      })
      return
    }

    // Validate module is a known AgentModule
    const validModules = ['PLANNER', 'GPA', 'ROADMAP', 'CHAT'] as const
    if (!(validModules as readonly string[]).includes(module)) {
      await prisma.autonomousAgentJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', result: { reason: 'unknown_module', module } },
      })
      return
    }

    const typedModule = module as typeof validModules[number]

    const sessionResult = await startSession(
      userId,
      typedModule,
      'SYSTEM',
      undefined,
      SYSTEM_IP,
      jobId,
    )

    // Handle flag-off skip
    if (sessionResult.blockedReason === 'SKIPPED_FLAG_OFF') {
      await prisma.autonomousAgentJob.update({
        where: { id: jobId },
        data: { status: 'SKIPPED_FLAG_OFF' },
      })
      return
    }

    // Handle COPPA block
    if (sessionResult.blockedReason === 'COPPA_GATE') {
      await prisma.autonomousAgentJob.update({
        where: { id: jobId },
        data: { status: 'SKIPPED_COPPA' },
      })
      return
    }

    const sessionId = sessionResult.sessionId

    // Deterministic check + (at most) a single cheap AI call — see
    // gpaCheckin.service.ts for the cost reasoning. Not an agentic
    // tool-calling loop: there's nothing here that benefits from one.
    const summaryMessage = triggerType === 'NIGHTLY_GPA_CHECKIN'
      ? (await runGpaCheckin(userId)).summary
      : buildSystemSummaryMessage(triggerType)

    await completeSession(sessionId, summaryMessage, 'COMPLETED')

    await prisma.autonomousAgentJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        result: { sessionId, triggerType, summary: summaryMessage },
      },
    })

    logger.info('autonomous_job_completed', { jobId, triggerType, sessionId })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    logger.error('autonomous_job_failed', { jobId, triggerType, error: errorMessage })

    await prisma.autonomousAgentJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', result: { error: errorMessage } },
    }).catch(() => {
      // Swallow secondary update failure to avoid masking original error in logs
    })
  }
}

/**
 * Fallback summary for any trigger type other than NIGHTLY_GPA_CHECKIN
 * (defensive — no other trigger type is currently enqueued).
 */
function buildSystemSummaryMessage(_triggerType: string): string {
  return 'Autonomous agent job completed.'
}

// ── Scheduler loop ────────────────────────────────────────────────────────────

let schedulerIntervalId: ReturnType<typeof setInterval> | null = null

/**
 * Starts the autonomous job scheduler.
 *
 * Called once from index.ts after server start.
 * Uses setInterval (appropriate for Render's persistent web service deployment).
 * Vercel/serverless: this interval would not survive invocation boundaries —
 * if the project ever moves to serverless, replace with an external cron trigger.
 */
export function startScheduler(): void {
  if (schedulerIntervalId !== null) {
    logger.warn('autonomous_scheduler_already_started', {})
    return
  }

  // Run worker batch every 60 seconds
  schedulerIntervalId = setInterval(() => {
    const nowUtc = new Date()
    const hourUtc = nowUtc.getUTCHours()
    const minuteUtc = nowUtc.getUTCMinutes()

    // Enqueue daily jobs at midnight UTC (first 5-minute window)
    if (hourUtc === 0 && minuteUtc < 5) {
      enqueueJobsForToday().catch(err => {
        logger.error('autonomous_enqueue_error', {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    // Always run the worker batch to process pending jobs
    runWorkerBatch().catch(err => {
      logger.error('autonomous_worker_error', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, 60 * 1000)

  logger.info('autonomous_scheduler_started', {
    enabled: process.env.AUTONOMOUS_AGENTS_ENABLED === 'true',
  })
}

export function stopScheduler(): void {
  if (schedulerIntervalId !== null) {
    clearInterval(schedulerIntervalId)
    schedulerIntervalId = null
    logger.info('autonomous_scheduler_stopped', {})
  }
}
