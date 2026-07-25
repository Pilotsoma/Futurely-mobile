/**
 * Unit tests for assignmentReminder.service.ts
 *
 * All external I/O is mocked:
 *   - prisma (assignment.findMany, assignment.update)
 *   - createAndSendNotification (notifications lib)
 *
 * The computeDeadline and formatDueSoonPreview helpers are also tested
 * directly (both are exported for testability).
 *
 * Coverage:
 *   (a) Correctly identifies assignments due in the future and within the
 *       70-minute catch-up window, and excludes ones outside it (already
 *       due, or too far out) — there is deliberately no lower bound beyond
 *       "still due in the future".
 *   (b) Skips PENDING-consent users.
 *   (c) Skips already-reminded assignments (reminderSentAt not null —
 *       enforced by the DB query filter, verified via the mock call).
 *   (d) dueDate is the sole deadline source — dueTime is display-only and
 *       ignored in all date math.
 *   (e) Sets reminderSentAt after a successful send.
 *   (f) One assignment's update failure doesn't block others in the batch.
 *   (g) A failed notification send doesn't get permanently marked as sent.
 */

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

const mockFindMany = jest.fn()
const mockUpdate = jest.fn()

jest.mock('../../lib/prisma', () => ({
  prisma: {
    assignment: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}))

const mockCreateAndSendNotification = jest.fn()

jest.mock('../../lib/notifications', () => ({
  createAndSendNotification: (...args: unknown[]) => mockCreateAndSendNotification(...args),
}))

// ── Subject under test ────────────────────────────────────────────────────────

import { checkAndSendReminders, computeDeadline, formatDueSoonPreview } from '../assignmentReminder.service'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAssignment(overrides: {
  id?: number
  userId?: number
  title?: string
  dueDate?: Date
  dueTime?: string | null
  completed?: boolean
  reminderSentAt?: Date | null
  coppaConsentStatus?: string
}) {
  return {
    id: overrides.id ?? 1,
    userId: overrides.userId ?? 42,
    title: overrides.title ?? 'Test Assignment',
    subject: 'Math',
    dueDate: overrides.dueDate ?? new Date(),
    dueTime: overrides.dueTime !== undefined ? overrides.dueTime : '14:00',
    completed: overrides.completed ?? false,
    reminderSentAt: overrides.reminderSentAt !== undefined ? overrides.reminderSentAt : null,
    user: { coppaConsentStatus: overrides.coppaConsentStatus ?? 'NOT_REQUIRED' },
  }
}

/** Returns a Date that is `offsetMs` milliseconds from now. */
function nowPlusMs(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs)
}

/**
 * Returns the `dueDate` to pass to `makeAssignment` so that `computeDeadline`
 * produces exactly `target`. Since the 2026-07-17 timezone fix, `dueDate` IS
 * the complete UTC deadline — `computeDeadline` returns it unchanged.
 */
function makeDeadlineInputs(target: Date): { dueDate: Date } {
  return { dueDate: target }
}

const MIN = 60 * 1000

// ── Suite: computeDeadline ────────────────────────────────────────────────────
//
// Since the 2026-07-17 timezone fix, dueDate is always a complete UTC timestamp
// (produced by the browser via .toISOString()). computeDeadline returns it
// unchanged — dueTime is a display-only field, not used in date math.

describe('computeDeadline', () => {
  it('returns the dueDate argument unchanged', () => {
    const date = new Date('2026-08-01T14:30:00.000Z')
    expect(computeDeadline(date)).toBe(date)
  })

  it('preserves the exact UTC instant for an afternoon deadline', () => {
    const date = new Date('2026-08-01T21:30:00.000Z') // 9:30 PM UTC
    expect(computeDeadline(date).toISOString()).toBe('2026-08-01T21:30:00.000Z')
  })

  it('preserves UTC midnight', () => {
    const date = new Date('2026-08-01T00:00:00.000Z')
    expect(computeDeadline(date).toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('preserves end-of-day UTC (23:59)', () => {
    const date = new Date('2026-08-01T23:59:00.000Z')
    expect(computeDeadline(date).toISOString()).toBe('2026-08-01T23:59:00.000Z')
  })

  it('preserves a date-time that crosses the UTC date boundary (e.g. US evening → next UTC day)', () => {
    // 9:30 PM US/Eastern (UTC-5) = 2026-08-02T02:30:00.000Z (next UTC day)
    const date = new Date('2026-08-02T02:30:00.000Z')
    expect(computeDeadline(date).toISOString()).toBe('2026-08-02T02:30:00.000Z')
  })
})

// ── Suite: checkAndSendReminders ──────────────────────────────────────────────

describe('formatDueSoonPreview', () => {
  it('reads "in about an hour" for 60 minutes remaining', () => {
    expect(formatDueSoonPreview('Essay', 60)).toBe('Essay is due in about an hour')
  })

  it('reads "in about an hour" just above the 40-minute bucket boundary (41 min)', () => {
    expect(formatDueSoonPreview('Essay', 41)).toBe('Essay is due in about an hour')
  })

  it('reads exact minutes remaining between 16 and 40 minutes', () => {
    expect(formatDueSoonPreview('Essay', 25)).toBe('Essay is due in about 25 minutes')
  })

  it('reads "less than 15 minutes" at the 15-minute boundary', () => {
    expect(formatDueSoonPreview('Essay', 15)).toBe('Essay is due in less than 15 minutes')
  })

  it('reads "less than 15 minutes" when almost due', () => {
    expect(formatDueSoonPreview('Essay', 1)).toBe('Essay is due in less than 15 minutes')
  })
})

describe('checkAndSendReminders', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateAndSendNotification.mockResolvedValue(true)
    mockUpdate.mockResolvedValue({})
  })

  // (a) Assignments within the catch-up window (due in the future, up to 70
  // min out) are processed; those outside are not. There's deliberately no
  // lower bound anymore beyond "still in the future" — see the file header
  // rationale on why a narrow band is fragile against cron scheduling jitter.
  it('(a) sends a reminder for an assignment whose deadline is exactly 60 min away', async () => {
    const target = nowPlusMs(60 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 1, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(1)
    expect(mockCreateAndSendNotification).toHaveBeenCalledTimes(1)
    expect(mockCreateAndSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: assignment.userId, type: 'ASSIGNMENT_DUE_SOON' }),
    )
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('(a) sends when deadline is only 10 min away (well below the old 50-min lower bound)', async () => {
    const target = nowPlusMs(10 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 10, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(1)
  })

  it('(a) sends when the deadline is only seconds away', async () => {
    const target = nowPlusMs(30 * 1000)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 14, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(1)
  })

  it('(a) does not send once the deadline has already passed', async () => {
    const target = nowPlusMs(-5 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 19, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(0)
    expect(mockCreateAndSendNotification).not.toHaveBeenCalled()
  })

  it('(a) does not send when deadline is 71 min away (above the 70-min upper bound)', async () => {
    const target = nowPlusMs(71 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 11, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(0)
    expect(mockCreateAndSendNotification).not.toHaveBeenCalled()
  })

  it('(a) sends near the upper boundary (69 min — inside the window)', async () => {
    const target = nowPlusMs(69 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 13, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(1)
  })

  // (b) PENDING consent users are skipped
  it('(b) skips assignments whose user has coppaConsentStatus PENDING', async () => {
    const target = nowPlusMs(60 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({
      id: 3,
      dueDate,
      coppaConsentStatus: 'PENDING',
    })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(0)
    expect(mockCreateAndSendNotification).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('(b) processes assignments for VERIFIED-consent users normally', async () => {
    const target = nowPlusMs(60 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 4, dueDate, coppaConsentStatus: 'VERIFIED' })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(1)
  })

  // (c) Already-reminded assignments excluded at query level
  it('(c) the DB query includes reminderSentAt: null as a filter', async () => {
    mockFindMany.mockResolvedValue([])

    await checkAndSendReminders()

    const callArgs = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(callArgs.where).toMatchObject({ reminderSentAt: null })
  })

  it('(c) the DB query also filters completed: false', async () => {
    mockFindMany.mockResolvedValue([])

    await checkAndSendReminders()

    const callArgs = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(callArgs.where).toMatchObject({ completed: false })
  })

  // (d) dueDate is the sole deadline source — dueTime is display-only and ignored.
  it('(d) assignment in the window fires regardless of dueTime display field value', async () => {
    // dueDate is already the correct UTC deadline; dueTime is just a display string
    const target = nowPlusMs(65 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    // Pass an arbitrary dueTime display value — it must have zero effect on the outcome
    const assignment = makeAssignment({ id: 20, dueDate, dueTime: 'bad-format' })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(1)
  })

  it('(d) an assignment whose dueDate is tomorrow is correctly outside the 50–70 min window', async () => {
    // dueDate is 24h in the future — well outside the reminder window.
    // dueTime display value is irrelevant to this check.
    const tomorrow = new Date(Date.now() + 24 * 60 * MIN)
    const assignment = makeAssignment({ id: 21, dueDate: tomorrow })

    mockFindMany.mockResolvedValue([assignment])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(0)
    expect(mockCreateAndSendNotification).not.toHaveBeenCalled()
  })

  // (e) reminderSentAt is set after a successful send
  it('(e) updates reminderSentAt on the assignment after sending the notification', async () => {
    const target = nowPlusMs(60 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 5, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    await checkAndSendReminders()

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { reminderSentAt: expect.any(Date) },
    })
  })

  it('(e) does NOT update reminderSentAt when the assignment is outside the window', async () => {
    const target = nowPlusMs(90 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 6, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    await checkAndSendReminders()

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  // (g) A failed notification must never permanently mark the assignment as
  // reminded — reminderSentAt is the query filter that excludes a row from
  // ever being reconsidered, so stamping it after a failed send would make
  // that failure silent and permanent instead of retryable on the next run.
  it('(g) does not set reminderSentAt when createAndSendNotification reports failure', async () => {
    const target = nowPlusMs(60 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 16, dueDate })

    mockFindMany.mockResolvedValue([assignment])
    mockCreateAndSendNotification.mockResolvedValueOnce(false)

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(0)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('(g) a failed send for one assignment does not block a successful one after it', async () => {
    const target60 = nowPlusMs(60 * MIN)
    const target62 = nowPlusMs(62 * MIN)

    const failing = makeAssignment({ id: 17, title: 'Failing', dueDate: target60 })
    const succeeding = makeAssignment({ id: 18, title: 'Succeeding', dueDate: target62 })

    mockFindMany.mockResolvedValue([failing, succeeding])
    mockCreateAndSendNotification
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(1)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 18 },
      data: { reminderSentAt: expect.any(Date) },
    })
  })

  // (f) Failure on one assignment does not block others
  it('(f) processes remaining assignments even if one throws on update', async () => {
    const target60 = nowPlusMs(60 * MIN)
    const target62 = nowPlusMs(62 * MIN)

    const failing = makeAssignment({ id: 7, title: 'Failing', dueDate: target60 })
    const succeeding = makeAssignment({ id: 8, title: 'Succeeding', dueDate: target62 })

    mockFindMany.mockResolvedValue([failing, succeeding])

    // First update throws; second succeeds
    mockUpdate
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({})

    const result = await checkAndSendReminders()

    // Both notifications were dispatched (createAndSendNotification never throws)
    expect(mockCreateAndSendNotification).toHaveBeenCalledTimes(2)
    // Only the second update succeeded, so processed = 1
    expect(result.processed).toBe(1)
  })

  it('returns { processed: 0 } when there are no candidates', async () => {
    mockFindMany.mockResolvedValue([])

    const result = await checkAndSendReminders()

    expect(result.processed).toBe(0)
    expect(mockCreateAndSendNotification).not.toHaveBeenCalled()
  })

  it('notification preview contains the assignment title', async () => {
    const target = nowPlusMs(60 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 9, title: 'Math Homework', dueDate })

    mockFindMany.mockResolvedValue([assignment])

    await checkAndSendReminders()

    expect(mockCreateAndSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        preview: 'Math Homework is due in about an hour',
      }),
    )
  })

  it('notification uses userId as both userId and fromUserId (self-notification pattern)', async () => {
    const target = nowPlusMs(60 * MIN)
    const { dueDate } = makeDeadlineInputs(target)
    const assignment = makeAssignment({ id: 15, userId: 99, dueDate })

    mockFindMany.mockResolvedValue([assignment])

    await checkAndSendReminders()

    expect(mockCreateAndSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 99, fromUserId: 99 }),
    )
  })
})
