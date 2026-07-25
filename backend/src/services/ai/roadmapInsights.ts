// prompt-version: 1.0
// last-updated: 2026-07-14
// author: ai-engineer
//
// PII policy: NO student names, emails, IDs, raw GPA values, or raw per-category
// credit counts enter the prompt. GPA is reduced to a positional label
// ('above average' | 'average' | 'below average') against standard unweighted
// GPA bands before prompt construction. Credit standing is described
// qualitatively ('on track in Math, significantly behind in Science').
// futureDecision (free-text, unconstrained) is normalized to the three-value
// enum 'college' | 'trade' | 'undecided' before entering the prompt.
// See COMPLIANCE.md for the full data-handling policy.

import { z } from 'zod'
import { logger } from '../../common/logger'
import { createChatCompletion } from '../../lib/aiClient'

// ── JSON-extraction helper (mirrors collegeInsightsPrompt.ts) ─────────────────

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1].trim() : raw.trim()
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface RoadmapInsightsInput {
  gradeLevel: number                     // 9-12
  creditsCompleted: number
  creditsRequired: number                // 26
  creditsByCategory: Record<string, number>
  weightedGpa: number
  unweightedGpa: number
  futureDecision: string | null          // free-text, unconstrained — normalized internally
}

export interface RoadmapMilestone {
  grade: number
  label: string
  done: boolean
}

// ── Zod output schema ─────────────────────────────────────────────────────────

const RoadmapMilestoneOutputSchema = z.object({
  grade: z.number().int().min(9).max(12),
  label: z.string().min(1),
})

const RoadmapLlmResponseSchema = z.object({
  milestones: z
    .array(RoadmapMilestoneOutputSchema)
    .length(4, 'LLM must return exactly 4 milestones, one per grade 9-12'),
})

// ── Typed error class ─────────────────────────────────────────────────────────

class RoadmapInsightsGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'RoadmapInsightsGenerationError'
  }
}

// ── Hardcoded fallback (exact original route behavior) ────────────────────────
//
// Mirrors the milestone array and `done` logic in backend/src/routes/roadmap.ts
// lines 73-78. `done = grade < gradeLevel` covers all four grades uniformly:
//   grade 9 → gradeLevel > 9, grade 10 → gradeLevel > 10, etc.
//   grade 12 → always false since gradeLevel tops out at 12.

export function buildFallbackMilestones(gradeLevel: number): RoadmapMilestone[] {
  return [
    { grade: 9,  label: 'Explore interests, build strong foundations',       done: 9  < gradeLevel },
    { grade: 10, label: 'Challenge yourself — consider AP or Honors courses', done: 10 < gradeLevel },
    { grade: 11, label: 'SAT/ACT prep, start college research',              done: 11 < gradeLevel },
    { grade: 12, label: 'Apply to colleges, finalize your plans',            done: 12 < gradeLevel },
  ]
}

// ── Input-reduction helpers (PII-safe positional labels) ──────────────────────

type GpaStanding = 'above average' | 'average' | 'below average'
type Pathway = 'college' | 'trade' | 'undecided'

/**
 * Reduce an unweighted GPA (0-4.0 scale) to a positional standing label.
 * Thresholds match common high-school GPA band conventions:
 *   ≥ 3.3 → above average, 2.5-3.3 → average, < 2.5 → below average.
 * Raw numeric GPA never appears in prompt output.
 */
function reduceGpa(unweightedGpa: number): GpaStanding {
  if (unweightedGpa >= 3.3) return 'above average'
  if (unweightedGpa >= 2.5) return 'average'
  return 'below average'
}

/**
 * Normalize unconstrained free-text futureDecision to a three-value pathway
 * enum. Never throws on unexpected values — defaults to 'undecided'.
 */
function normalizePathway(futureDecision: string | null): Pathway {
  if (!futureDecision || futureDecision.trim() === '') return 'undecided'
  const lower = futureDecision.toLowerCase()
  if (/college|university|4.?year/.test(lower)) return 'college'
  if (/trade|vocational|technical|work|job|career|apprentice/.test(lower)) return 'trade'
  return 'undecided'
}

// Approximate per-category credit minimums for a standard 26-credit graduation
// plan. Used only to determine qualitative gap labels — never passed as raw
// numbers. Electives have no hard minimum and are excluded.
const CATEGORY_MINIMUMS: Record<string, number> = {
  English:          4,
  Math:             4,
  Science:          4,
  'Social Studies': 3,
  Language:         2,
  'Fine Arts':      1,
  'PE / Health':    1,
}

/**
 * Produce a qualitative, non-numeric description of where the student stands
 * across subject-area credit requirements. Example output:
 * "significantly behind in: Science; somewhat short in: Social Studies;
 *  on track in: English, Math"
 */
function describeCreditGaps(creditsByCategory: Record<string, number>): string {
  const onTrack: string[] = []
  const short: string[] = []
  const significantlyShort: string[] = []

  for (const [cat, min] of Object.entries(CATEGORY_MINIMUMS)) {
    const earned = creditsByCategory[cat] ?? 0
    const remaining = min - earned
    if (remaining <= 0) {
      onTrack.push(cat)
    } else if (remaining <= min * 0.5) {
      short.push(cat)
    } else {
      significantlyShort.push(cat)
    }
  }

  const parts: string[] = []
  if (significantlyShort.length > 0) parts.push(`significantly behind in: ${significantlyShort.join(', ')}`)
  if (short.length > 0)             parts.push(`somewhat short in: ${short.join(', ')}`)
  if (onTrack.length > 0)           parts.push(`on track in: ${onTrack.join(', ')}`)

  return parts.length > 0 ? parts.join('; ') : 'no subject-area credit data available'
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an experienced high school academic advisor. Your job is to write a personalized 4-milestone roadmap — one milestone per grade (9, 10, 11, 12) — tailored to a real student's current standing.

Tone: encouraging, practical, and direct. Plain English only. No jargon, no markdown formatting within the label text, no bullet points within a label, no colons used as headers.

Each milestone must be a single actionable sentence. Shorter is better — the student will read this on a progress tracker, not in an email.

When writing milestones:
- Grades before the student's current grade: affirm the foundation already built and note what carries forward into the years ahead.
- The student's current grade: give specific, actionable advice the student can act on right now this school year, grounded in their credit standing and pathway.
- Future grades: forward-looking steps tailored to the student's stated pathway (college, trade/vocational, or undecided).

Tailor every milestone to the pathway and credit standing provided. Do not give generic advice when specific context is available.

Respond with ONLY valid JSON in exactly this shape — no markdown fences, no extra keys, no explanation:
{
  "milestones": [
    { "grade": 9,  "label": "<single sentence>" },
    { "grade": 10, "label": "<single sentence>" },
    { "grade": 11, "label": "<single sentence>" },
    { "grade": 12, "label": "<single sentence>" }
  ]
}`
}

function buildPathwayHint(pathway: Pathway): string {
  switch (pathway) {
    case 'college':
      return 'Focus on academic rigor, GPA upkeep, and extracurricular depth at each grade, with college applications as the grade-12 endpoint.'
    case 'trade':
      return 'Focus on relevant electives, certifications, dual-enrollment vocational programs, and internships or apprenticeships at each grade.'
    case 'undecided':
      return 'Keep options open — advise building a strong academic record while exploring both college and career pathways at each grade.'
  }
}

function buildUserPrompt(
  gradeLevel: number,
  pathway: Pathway,
  gpaStanding: GpaStanding,
  creditProgressPct: number,
  creditGaps: string,
): string {
  return `Generate a personalized 4-milestone roadmap for this student:

Current grade level: ${gradeLevel}
Stated pathway: ${pathway}
Academic standing: GPA is ${gpaStanding} compared to typical high school peers
Overall credit progress: approximately ${creditProgressPct}% of required credits completed
Credit standing by subject area: ${creditGaps}

Pathway guidance: ${buildPathwayHint(pathway)}

For the grade ${gradeLevel} milestone specifically: make it something the student can start acting on right now this school year, drawing on their credit standing and pathway above.`
}

// ── Core LLM call (internal — throws on failure) ──────────────────────────────

async function generateMilestonesFromLlm(
  input: RoadmapInsightsInput,
  pathway: Pathway,
): Promise<RoadmapMilestone[]> {
  const startMs = Date.now()

  const gpaStanding    = reduceGpa(input.unweightedGpa)
  const creditPct      = Math.round((input.creditsCompleted / input.creditsRequired) * 100)
  const creditGaps     = describeCreditGaps(input.creditsByCategory)

  let raw: string
  try {
    const response = await createChatCompletion({
      max_tokens: 400,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: buildUserPrompt(input.gradeLevel, pathway, gpaStanding, creditPct, creditGaps),
        },
      ],
    })
    raw = response.choices[0]?.message?.content ?? ''
  } catch (sdkError) {
    // Never log prompt contents — it contains student context
    logger.warn('Roadmap insights LLM call failed', {
      feature: 'roadmapInsights',
      errorType: sdkError instanceof Error ? sdkError.constructor.name : 'UnknownError',
      latencyMs: Date.now() - startMs,
    })
    throw new RoadmapInsightsGenerationError('LLM call failed — SDK or network error', sdkError)
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(extractJson(raw))
  } catch (parseError) {
    logger.warn('Roadmap insights LLM returned invalid JSON', {
      feature: 'roadmapInsights',
      latencyMs: Date.now() - startMs,
    })
    throw new RoadmapInsightsGenerationError('LLM returned invalid JSON', parseError)
  }

  const parseResult = RoadmapLlmResponseSchema.safeParse(parsedJson)
  if (!parseResult.success) {
    logger.warn('Roadmap insights LLM output failed schema validation', {
      feature: 'roadmapInsights',
      issues: parseResult.error.issues.map((i) => i.message),
      latencyMs: Date.now() - startMs,
    })
    throw new RoadmapInsightsGenerationError(
      `LLM output failed schema validation: ${parseResult.error.issues.map((i) => i.message).join(', ')}`,
    )
  }

  // Non-PII success log: pathway, GPA standing, latency only — no raw academics
  logger.info('Roadmap insights generated', {
    feature: 'roadmapInsights',
    pathway,
    gpaStanding,
    latencyMs: Date.now() - startMs,
  })

  return parseResult.data.milestones.map((m) => ({
    grade: m.grade,
    label: m.label,
    done: m.grade < input.gradeLevel,
  }))
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate personalized 4-grade roadmap milestones for a student.
 *
 * PII policy: raw GPA values are reduced to a positional label before the
 * prompt is built. Per-category credit counts are described qualitatively.
 * futureDecision (free-text, potentially null) is normalized to
 * 'college' | 'trade' | 'undecided'. No student name, ID, email, or any
 * raw numeric academic record enters the prompt or any log line.
 *
 * Never throws. On any failure (LLM error, timeout, malformed JSON, schema
 * validation failure), logs a WARN and returns the original 4 hardcoded
 * milestones with the same `done = grade < gradeLevel` logic used by the
 * current roadmap route — the feature always degrades to today's behavior.
 */
export async function generatePersonalizedMilestones(
  input: RoadmapInsightsInput,
): Promise<RoadmapMilestone[]> {
  const pathway = normalizePathway(input.futureDecision)

  try {
    return await generateMilestonesFromLlm(input, pathway)
  } catch (err) {
    logger.warn('Roadmap insights falling back to hardcoded milestones', {
      feature: 'roadmapInsights',
      pathway,
      errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
    })
    return buildFallbackMilestones(input.gradeLevel)
  }
}
