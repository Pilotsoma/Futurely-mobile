// Nightly GPA check-in — the one autonomous (non-user-triggered) AI feature
// in this app. Deliberately NOT an agentic tool-calling loop: the GPA read
// tools it would otherwise call are just deterministic Prisma queries + pure
// math (calculateGpa), so there's nothing for a multi-turn loop to gain here.
//
// Cost design:
// - The GPA comparison itself is 100% deterministic, zero AI cost.
// - The AI is only called when the GPA has actually changed since the last
//   check-in — most days, for most students, that's false, so most days this
//   makes zero AI calls at all.
// - When it IS called, it's a single completion pinned to the 'basic' tier
//   (OpenRouter, defaults to the free-tier `openrouter/free` model) rather
//   than whatever AI_PROVIDER happens to be configured elsewhere — this
//   feature runs automatically with no user request behind it, so it should
//   never be the thing that pulls in a paid/advanced model.
// - Any AI failure falls back to a deterministic templated message rather
//   than skipping the notification — the student still gets told their GPA
//   changed, just with a plainer sentence.

import { prisma } from '../lib/prisma'
import { logger } from '../common/logger'
import { calculateGpa, GradeInput } from '../lib/gpa'
import { createTieredChatCompletion } from '../lib/aiClient'
import { createAndSendNotification } from '../lib/notifications'

export interface GpaCheckinResult {
  notified: boolean
  summary: string
}

// Ignore GPA float noise smaller than this — not a "real" change worth a
// notification (e.g. rounding differences from a re-sync).
const CHANGE_EPSILON = 0.01

async function computeCurrentGpa(userId: number): Promise<{ weighted: number; unweighted: number } | null> {
  const courses = await prisma.course.findMany({
    where: { userId },
    include: {
      grades: { where: { gradingPeriod: 'CURRENT' }, take: 1 },
    },
  })

  const inputs: GradeInput[] = courses
    .filter(c => c.grades.length > 0)
    .map(c => ({
      letterGrade: c.grades[0]!.letterGrade,
      creditHours: c.creditHours,
      courseType: c.courseType,
    }))

  return calculateGpa(inputs)
}

function fallbackMessage(prevWeighted: number, curWeighted: number, curUnweighted: number): string {
  const delta = curWeighted - prevWeighted
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'about the same'
  return `Your GPA is ${direction} — now ${curWeighted.toFixed(2)} weighted / ${curUnweighted.toFixed(2)} unweighted.`
}

async function generateCheckinMessage(
  prevWeighted: number,
  curWeighted: number,
  prevUnweighted: number,
  curUnweighted: number,
): Promise<string> {
  try {
    const response = await createTieredChatCompletion('basic', {
      max_tokens: 60,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: 'You write a single short, encouraging one-sentence GPA check-in notification for a high school student. No greeting, no sign-off, no quotation marks — just the one sentence.',
        },
        {
          role: 'user',
          content: `Previous GPA: ${prevWeighted.toFixed(2)} weighted / ${prevUnweighted.toFixed(2)} unweighted.\nCurrent GPA: ${curWeighted.toFixed(2)} weighted / ${curUnweighted.toFixed(2)} unweighted.`,
        },
      ],
    })
    const text = response.choices[0]?.message?.content?.trim()
    if (text) return text
  } catch (err) {
    logger.warn('gpa_checkin_ai_failed', { error: err instanceof Error ? err.message : String(err) })
  }
  return fallbackMessage(prevWeighted, curWeighted, curUnweighted)
}

/**
 * Runs one user's nightly GPA check-in. Called by the autonomous job
 * scheduler — never by a direct user request.
 */
export async function runGpaCheckin(userId: number): Promise<GpaCheckinResult> {
  const current = await computeCurrentGpa(userId)
  if (current === null) {
    return { notified: false, summary: 'No grades on file yet — nothing to check in on.' }
  }

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { lastGpaCheckinWeighted: true, lastGpaCheckinUnweighted: true },
  })

  const prevWeighted = profile?.lastGpaCheckinWeighted ?? null
  const prevUnweighted = profile?.lastGpaCheckinUnweighted ?? null

  // First-ever check-in: record the baseline silently. There's nothing to
  // compare against yet, so nothing meaningful to tell the student — and no
  // AI call needed to say so.
  if (prevWeighted === null || prevUnweighted === null) {
    await prisma.profile.upsert({
      where: { userId },
      create: { userId, lastGpaCheckinWeighted: current.weighted, lastGpaCheckinUnweighted: current.unweighted },
      update: { lastGpaCheckinWeighted: current.weighted, lastGpaCheckinUnweighted: current.unweighted },
    })
    return { notified: false, summary: 'First check-in — baseline GPA recorded, no prior value to compare against.' }
  }

  const changed =
    Math.abs(current.weighted - prevWeighted) >= CHANGE_EPSILON ||
    Math.abs(current.unweighted - prevUnweighted) >= CHANGE_EPSILON

  if (!changed) {
    return { notified: false, summary: 'GPA unchanged since last check-in — nothing to report.' }
  }

  const message = await generateCheckinMessage(prevWeighted, current.weighted, prevUnweighted, current.unweighted)

  const sent = await createAndSendNotification({
    userId,
    fromUserId: userId,
    type: 'GPA_CHECKIN',
    preview: message,
  })

  if (sent) {
    await prisma.profile.update({
      where: { userId },
      data: { lastGpaCheckinWeighted: current.weighted, lastGpaCheckinUnweighted: current.unweighted },
    })
  }

  return { notified: sent, summary: message }
}
