// prompt-version: 2.0
// last-updated: 2026-07-13
// author: ai-engineer
//
// PII policy: NO student names, emails, IDs, raw SAT scores, or raw GPA values
// may appear in the prompt — those stay reduced to derived/positional fields
// (satPosition, gpaPosition). Real course names/grades, class rank, and
// attendance ARE included as of v2.0 so the model can give course-specific,
// non-generic advice — this mirrors what the AI chat's personalized handler
// (routes/ai.ts) already sends to the same LLM provider under the same
// consent gate (requireConsent), so this isn't a new category of exposure.
// See COMPLIANCE.md for the full data-handling policy.

import { z } from 'zod'
import { logger } from '../../common/logger'
import { createChatCompletion } from '../../lib/aiClient'
import type {
  CollegeInsightsPayload,
  CollegeInsightsPromptInput,
  GpaPosition,
  SatPosition,
} from '../../types/collegeInsights'

// Strip markdown code fences and extract raw JSON — mirrors the pattern used
// by the other AI routes in this codebase (see routes/ai.ts extractJson).
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1].trim() : raw.trim()
}

// ── Typed error class ─────────────────────────────────────────────────────────

/**
 * Thrown when the LLM call fails for any reason (network error, timeout, SDK
 * error, or schema validation failure).  The caller in collegeInsights.ts
 * catches this specific class and falls back to stale-cache data.
 */
export class CollegeInsightsGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'CollegeInsightsGenerationError'
  }
}

// ── Zod validation schema ─────────────────────────────────────────────────────

const ActionableStepSchema = z.object({
  step: z.string().min(1, 'step must be non-empty'),
  category: z.enum(['test', 'gpa', 'essay', 'extracurricular', 'strategy']),
  priority: z.enum(['high', 'medium', 'low']),
})

const CollegeInsightsPayloadSchema = z.object({
  narrativeSummary: z.string().min(1, 'narrativeSummary must be non-empty'),
  actionableSteps: z
    .array(ActionableStepSchema)
    .min(3, 'at least 3 actionable steps required')
    .max(5, 'at most 5 actionable steps allowed'),
})

// ── Human-readable label mappings (never expose raw numbers) ──────────────────

function describeSatPosition(position: SatPosition, delta: number | null): string {
  switch (position) {
    case 'well_below_25th': {
      const gap = delta !== null ? ` (approximately ${Math.abs(Math.round(delta))} points below the 25th-percentile cutoff)` : ''
      return `well below the 25th percentile of enrolled students${gap}`
    }
    case 'below_25th':
      return 'slightly below the 25th percentile of enrolled students'
    case 'in_band':
      return 'within the middle 50% SAT range of enrolled students'
    case 'above_75th':
      return 'above the 75th percentile of enrolled students'
    case 'not_provided':
      return 'not provided'
  }
}

function describeGpaPosition(position: GpaPosition): string {
  switch (position) {
    case 'well_below_mean':
      return 'significantly below the average applicant GPA'
    case 'below_mean':
      return 'slightly below the average applicant GPA'
    case 'at_mean':
      return 'near the average applicant GPA'
    case 'above_mean':
      return 'above the average applicant GPA'
    case 'not_provided':
      return 'not provided'
  }
}

function describeLabelContext(label: string, admissionRatePct: number): string {
  switch (label) {
    case 'Likely':
      return `This is a strong match — the student's profile aligns well with ${admissionRatePct.toFixed(0)}% admission rate. The focus now is on essay quality and application polish.`
    case 'Possible':
      return `This is a competitive match — the student has a reasonable shot given the ${admissionRatePct.toFixed(0)}% admission rate, but strong essays and addressing any profile gaps will be important.`
    case 'Reach':
      return `This is a reach school — admission is challenging given the ${admissionRatePct.toFixed(0)}% admission rate, but achievable with a standout application that highlights unique strengths.`
    case 'Far Reach':
      return `This is a far reach — the ${admissionRatePct.toFixed(0)}% admission rate is very competitive, and this college should be treated as an aspirational target alongside a balanced list.`
    default:
      return `Admission rate is approximately ${admissionRatePct.toFixed(0)}%.`
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an experienced, encouraging high school college admissions counselor. Your role is to help students understand where they stand relative to a college and give them clear, actionable guidance they can act on now.

Your tone is warm, supportive, and realistic — never discouraging, but never falsely optimistic. You use plain English; no jargon, no percentages in the narrative, no raw test scores. You help students feel capable and motivated.

When the student's actual courses, class rank, or attendance are provided below, ground your narrative and steps in that real data — name specific courses, note gaps in rigor, or flag attendance if it's relevant. Never fall back to generic advice like "just study more" when specific data is available to reference instead.

Write narrativeSummary and each step's "step" text in plain prose only — the app renders these as plain text, not markdown, so never use **bold**, *italics*, bullet points, headers, or code fences within them.

Respond with ONLY a JSON object in exactly this shape (no markdown, no extra text):
{
  "narrativeSummary": "<150-250 word string>",
  "actionableSteps": [
    { "step": "<string>", "category": "test" | "gpa" | "essay" | "extracurricular" | "strategy", "priority": "high" | "medium" | "low" }
  ]
}
actionableSteps must contain between 3 and 5 items.`
}

function buildUserPrompt(input: CollegeInsightsPromptInput): string {
  const admissionRatePct = input.admissionRate * 100
  const satSection =
    input.satPosition !== 'not_provided'
      ? `SAT position: ${describeSatPosition(input.satPosition, input.satDeltaFrom25th)}`
      : null
  const gpaSection =
    input.gpaPosition !== 'not_provided'
      ? `GPA position: ${describeGpaPosition(input.gpaPosition)}`
      : null
  const gradeLevelSection = input.gradeLevel !== null ? `Grade level: ${input.gradeLevel}` : null
  const courseSection = input.courseList.length > 0
    ? `Current courses: ${input.courseList.join(', ')}\nRigorous (AP/IB/Honors/dual-enrollment) course count: ${input.rigorousCourseCount}`
    : null
  const classRankSection = input.classRank ? `Class rank: ${input.classRank}` : null
  const attendanceSection = input.attendanceSummary ? `Attendance: ${input.attendanceSummary}` : null

  const profileLines = [
    `College: ${input.collegeName}`,
    `Fit score: ${input.score}/100 (label: ${input.label})`,
    `Label context: ${describeLabelContext(input.label, admissionRatePct)}`,
    satSection,
    gpaSection,
    satSection === null ? 'SAT data: not provided — do not give SAT-specific advice' : null,
    gpaSection === null ? 'GPA data: not provided — do not give GPA-specific advice' : null,
    gradeLevelSection,
    courseSection,
    classRankSection,
    attendanceSection,
    courseSection === null ? 'Course data: not provided — do not reference specific classes' : null,
  ]
    .filter(Boolean)
    .join('\n')

  const stepGuidance = buildStepGuidance(input)

  return `Generate college admission insights for the following student profile:

${profileLines}

Instructions for the narrative (narrativeSummary):
- Write 150–250 words.
- Explain what the fit score and label mean in plain English.
- Acknowledge any SAT or GPA positioning, but ONLY if the data was provided above.
- Be encouraging and concrete. Frame this as coaching, not judgment.
- Do NOT include raw numbers, percentages, or test scores in the narrative.

Instructions for actionable steps (actionableSteps):
- Provide exactly 3 to 5 steps.
- ${stepGuidance}
- Use the category values: test, gpa, essay, extracurricular, strategy.
- Use the priority values: high, medium, low.
- Each step should be specific and actionable, not generic platitudes.
- Do NOT include test-prep steps when SAT data is not provided.
- Do NOT include GPA-improvement steps when GPA data is not provided.`
}

function buildStepGuidance(input: CollegeInsightsPromptInput): string {
  const parts: string[] = []

  if (input.label === 'Far Reach') {
    parts.push('Include a "strategy" step about balancing this aspiration with a realistic college list.')
  }
  if (input.label === 'Reach') {
    parts.push('Include a "strategy" step naming what specifically would move this from a reach toward a solid match — reference their actual course rigor or class rank below if provided, not generic effort.')
  }
  if (input.satPosition === 'well_below_25th' || input.satPosition === 'below_25th') {
    parts.push('Include a high-priority "test" step about SAT preparation.')
  }
  if (input.gpaPosition === 'well_below_mean' || input.gpaPosition === 'below_mean') {
    parts.push('Include a high-priority "gpa" step about academic improvement — if specific current courses are listed below, name the ones most worth prioritizing rather than saying "study more."')
  }
  if (input.label === 'Likely' || input.label === 'Possible') {
    parts.push('Emphasize "essay" and "extracurricular" steps since those become the differentiators at this fit level.')
  }
  if (input.courseList.length > 0 && input.rigorousCourseCount === 0 && (input.label === 'Reach' || input.label === 'Far Reach')) {
    parts.push('Include a "gpa" or "strategy" step recommending specific next-semester course rigor (AP/IB/Honors/dual-enrollment) given none of their current courses are advanced-level.')
  }
  if (input.classRank) {
    parts.push('Weave the class rank context into the narrative or a "strategy" step where relevant, instead of ignoring it.')
  }

  return parts.length > 0 ? parts.join(' ') : 'Balance across essay, strategy, and any relevant academic areas, referencing their actual courses and class rank below if provided instead of generic advice.'
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a narrative summary and actionable steps for a student's college
 * admission profile relative to a specific institution.
 *
 * Uses the same OpenRouter-backed model as the rest of NextStep's AI features
 * (see routes/ai.ts), prompted to return a strict JSON shape which is then
 * validated with Zod before returning.
 *
 * Throws {@link CollegeInsightsGenerationError} on any LLM failure (network,
 * timeout, SDK error, malformed JSON, or schema validation mismatch). The
 * caller in collegeInsights.ts catches this class and falls back to
 * stale-cache data.
 *
 * PII policy: the prompt is built entirely from derived/positional fields in
 * {@link CollegeInsightsPromptInput}. No student name, email, ID, raw SAT
 * score, or raw GPA value enters the prompt. Logs contain only non-PII
 * metadata (label, category counts, latency).
 */
export async function generateCollegeInsights(
  input: CollegeInsightsPromptInput
): Promise<CollegeInsightsPayload> {
  const maxAttempts = 3
  const backoffMs = [300, 900]

  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await generateCollegeInsightsOnce(input)
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts - 1) {
        logger.warn('College insights generation attempt failed — retrying', {
          feature: 'collegeInsights',
          attempt: attempt + 1,
        })
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]))
      }
    }
  }

  throw lastError
}

async function generateCollegeInsightsOnce(
  input: CollegeInsightsPromptInput
): Promise<CollegeInsightsPayload> {
  const startMs = Date.now()

  let raw: string
  try {
    const response = await createChatCompletion({
      max_tokens: 600,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(input) },
      ],
    })

    raw = response.choices[0]?.message?.content ?? ''
  } catch (sdkError) {
    // Never log prompt contents — it contains student context
    logger.warn('College insights LLM call failed', {
      feature: 'collegeInsights',
      errorType: sdkError instanceof Error ? sdkError.constructor.name : 'UnknownError',
      latencyMs: Date.now() - startMs,
    })
    throw new CollegeInsightsGenerationError(
      'LLM call failed — SDK or network error',
      sdkError
    )
  }

  // ── Parse and validate the JSON response ──────────────────────────────────

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(extractJson(raw))
  } catch (parseError) {
    logger.warn('College insights LLM returned invalid JSON', {
      feature: 'collegeInsights',
      latencyMs: Date.now() - startMs,
    })
    throw new CollegeInsightsGenerationError('LLM returned invalid JSON', parseError)
  }

  const parseResult = CollegeInsightsPayloadSchema.safeParse(parsedJson)

  if (!parseResult.success) {
    logger.warn('College insights LLM output failed schema validation', {
      feature: 'collegeInsights',
      issues: parseResult.error.issues.map((i) => i.message),
      latencyMs: Date.now() - startMs,
    })
    throw new CollegeInsightsGenerationError(
      `LLM output failed schema validation: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
    )
  }

  const payload = parseResult.data

  // Non-PII success log: only label, step count, and category distribution
  logger.info('College insights generated', {
    feature: 'collegeInsights',
    label: input.label,
    stepCount: payload.actionableSteps.length,
    categories: payload.actionableSteps.map((s) => s.category),
    latencyMs: Date.now() - startMs,
  })

  return payload
}
