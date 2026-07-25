/**
 * Assignment reminder service.
 *
 * Invoked by a GitHub Actions scheduled workflow (GET /api/cron/assignment-
 * reminders, nominally every 10 minutes — see .github/workflows/assignment-
 * reminders.yml). For each incomplete assignment due within the next ~70
 * minutes that has not yet had a reminder sent, it fires an in-app
 * ASSIGNMENT_DUE_SOON notification and stamps `reminderSentAt` on the row.
 *
 * Design notes:
 * - The eligibility window is deliberately a catch-up window — "due sometime
 *   in the next WINDOW_UPPER_MS, hasn't been reminded yet" — rather than a
 *   narrow band like "due in exactly 50-70 minutes". GitHub Actions
 *   `schedule` triggers are not guaranteed to fire exactly on time (GitHub
 *   documents delays, especially under load); a narrow band checked by an
 *   imprecise scheduler can be skipped entirely if an assignment is created
 *   close to (or the tick lands late relative to) the band's edge. A wide,
 *   monotonically-shrinking window means any tick that fires at all while the
 *   deadline is still in the future and within range will catch it — the
 *   assignment is never structurally unreachable, only the flavor text of
 *   "how soon" varies with how close to the deadline the catching tick landed.
 * - Each assignment is processed independently (no batch transaction) so that a
 *   failure on one row does not abort the remainder of the batch.
 * - No ComplianceAuditLog entry is written here, consistent with the existing
 *   ASSIGNMENT_CREATED notification which is also not audit-logged (assignment
 *   metadata is not a FERPA-protected education record under current architect
 *   ruling).
 * - PENDING-consent users are explicitly excluded even though a correctly-
 *   functioning system should have no assignments for them. The cron route has
 *   no upstream auth middleware, so this filter is defensive, not redundant.
 */

import { prisma } from '../lib/prisma'
import { logger } from '../common/logger'
import { createAndSendNotification } from '../lib/notifications'

export interface ReminderResult {
  processed: number
}

/**
 * Upper bound (milliseconds): don't remind for anything due further out than
 * this — the point is a "coming up soon" nudge, not an early heads-up.
 * There is deliberately no lower bound beyond "still due in the future" — see
 * the catch-up window rationale in the file header comment above.
 */
const WINDOW_UPPER_MS = 70 * 60 * 1000 // 70 minutes

/**
 * DB pre-filter, applied at query time. A small negative lower bound (rather
 * than exactly `now`) tolerates clock skew and in-flight query latency so an
 * assignment due in the next few seconds isn't excluded by a hair.
 */
const DB_PREFILTER_LOWER_MS = -60 * 1000 // 1 minute in the past
const DB_PREFILTER_UPPER_MS = WINDOW_UPPER_MS + 5 * 60 * 1000 // window + 5min buffer

/**
 * Returns the effective UTC deadline for an assignment.
 *
 * Since the 2026-07-17 timezone fix, `dueDate` is always a complete,
 * timezone-correct UTC timestamp (constructed by the browser client in the
 * user's real local timezone and converted to UTC via .toISOString() before
 * being stored). The `dueTime` column is now a display-only field ("21:30")
 * with no role in date math — `dueDate` is the single source of truth.
 */
export function computeDeadline(dueDate: Date): Date {
  return dueDate
}

/**
 * Given the minutes remaining until an assignment is due, returns the
 * ASSIGNMENT_DUE_SOON notification's preview text. Dynamic rather than a
 * fixed "in about an hour" string, since the catch-up window (see file
 * header) means a late-running cron tick can legitimately catch an
 * assignment anywhere from just-over-an-hour down to a few minutes out.
 */
export function formatDueSoonPreview(title: string, minutesRemaining: number): string {
  if (minutesRemaining <= 15) return `${title} is due in less than 15 minutes`
  if (minutesRemaining <= 40) return `${title} is due in about ${minutesRemaining} minutes`
  return `${title} is due in about an hour`
}

/**
 * Finds all incomplete, not-yet-reminded assignments due within the next
 * WINDOW_UPPER_MS, skips those with a PENDING coppaConsentStatus, and sends
 * each eligible one an in-app ASSIGNMENT_DUE_SOON notification, then stamps
 * `reminderSentAt`.
 *
 * Returns the count of reminders successfully dispatched.
 */
export async function checkAndSendReminders(): Promise<ReminderResult> {
  const now = new Date()
  const prefilterStart = new Date(now.getTime() + DB_PREFILTER_LOWER_MS)
  const prefilterEnd = new Date(now.getTime() + DB_PREFILTER_UPPER_MS)

  const candidates = await prisma.assignment.findMany({
    where: {
      completed: false,
      reminderSentAt: null,
      dueDate: {
        gte: prefilterStart,
        lte: prefilterEnd,
      },
    },
    include: {
      user: {
        select: { coppaConsentStatus: true },
      },
    },
  })

  const windowEnd = now.getTime() + WINDOW_UPPER_MS

  let processed = 0

  for (const assignment of candidates) {
    // Defensive COPPA filter — cron has no upstream auth/consent middleware
    if (assignment.user.coppaConsentStatus === 'PENDING') {
      logger.warn('assignment_reminder_skipped_coppa_pending', { assignmentId: assignment.id })
      continue
    }

    const deadline = computeDeadline(assignment.dueDate)
    const deadlineMs = deadline.getTime()

    // Still due in the future, and not further out than the catch-up window.
    if (deadlineMs < now.getTime() || deadlineMs > windowEnd) {
      continue
    }

    try {
      const minutesRemaining = Math.max(0, Math.round((deadlineMs - now.getTime()) / 60000))

      // createAndSendNotification never throws — it returns false on failure
      // instead. That return value MUST be checked here: reminderSentAt is a
      // permanent "never retry" marker (the query filter above excludes any
      // row where it's already set), so blindly stamping it regardless of
      // whether the notification actually got created would turn any
      // transient DB hiccup into a silent, permanent, unretryable failure —
      // the assignment would never be reconsidered by a later cron run, and
      // the student would simply never get a reminder for it, with no error
      // visible anywhere (the cron endpoint still returns 200).
      const sent = await createAndSendNotification({
        userId: assignment.userId,
        fromUserId: assignment.userId,
        type: 'ASSIGNMENT_DUE_SOON',
        preview: formatDueSoonPreview(assignment.title, minutesRemaining),
      })

      if (!sent) {
        logger.error('assignment_reminder_notification_failed', { assignmentId: assignment.id })
        continue
      }

      // Mark reminder sent only after notification was actually dispatched
      await prisma.assignment.update({
        where: { id: assignment.id },
        data: { reminderSentAt: new Date() },
      })

      processed++
    } catch (err) {
      // A failure on one assignment (e.g., DB write to mark reminderSentAt) must
      // not abort the loop. Log with assignment ID only — no PII.
      logger.error('assignment_reminder_processing_failed', {
        assignmentId: assignment.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('assignment_reminders_completed', { processed, candidates: candidates.length })

  return { processed }
}
