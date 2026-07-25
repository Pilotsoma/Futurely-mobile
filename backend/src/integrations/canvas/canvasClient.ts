import axios, { AxiosError } from 'axios'
import { logger } from '../../common/logger'

// ── Typed error classes ──────────────────────────────────────────────────────

export class CanvasTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanvasTokenError'
  }
}

export class CanvasNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanvasNetworkError'
  }
}

export class CanvasApiError extends Error {
  public readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CanvasApiError'
    this.status = status
  }
}

// ── Response interfaces ──────────────────────────────────────────────────────

export interface CanvasSelf {
  id: number
  name: string
}

export interface CanvasTodoItem {
  type: string
  assignment: {
    id: number
    name: string
    due_at: string | null
    points_possible: number | null
    course_id: number
    html_url: string
  }
  context_name: string
  html_url: string
  ignore: string
}

export interface CanvasModuleItem {
  id: number
  title: string
  type: string
  content_id: number | null
  html_url: string
  url: string | null
  published: boolean
  completion_requirement: {
    type: string
    min_score?: number
    completed: boolean
  } | null
}

export interface CanvasModule {
  id: number
  name: string
  position: number
  unlock_at: string | null
  items_count: number
  items: CanvasModuleItem[]
}

export interface CanvasAnnouncement {
  id: number
  title: string
  message: string
  posted_at: string
  author: { display_name: string; avatar_image_url: string | null }
  read_state: string
  html_url: string
}

export interface CanvasAssignmentDetail {
  id: number
  name: string
  description: string | null
  due_at: string | null
  points_possible: number | null
  submission_types: string[]
  html_url: string
  course_id: number
  submission: CanvasSubmission | null
  rubric?: Array<{
    id: string
    description: string
    long_description: string
    points: number
  }>
}

export interface CanvasPage {
  url: string
  title: string
  body: string | null
  updated_at: string
}

export interface CanvasDiscussionParticipant {
  id: number
  display_name: string
  avatar_image_url: string | null
}

export interface CanvasDiscussionEntry {
  id: number
  user_id: number
  message: string
  created_at: string
  replies?: CanvasDiscussionEntry[]
  read_state?: string
}

export interface CanvasDiscussionTopic {
  id: number
  title: string
  message: string | null
  posted_at: string
  discussion_type: string
  assignment_id: number | null
  html_url: string
  author: { display_name: string; avatar_image_url: string | null }
}

export interface CanvasDiscussionView {
  participants: CanvasDiscussionParticipant[]
  unread_entries: number[]
  view: CanvasDiscussionEntry[]
}

export interface CanvasQuizAnswer {
  id: number
  text: string
  html?: string
  weight: number
}

export interface CanvasQuizQuestion {
  id: number
  question_name: string
  question_text: string
  question_type: string
  points_possible: number
  answers?: CanvasQuizAnswer[]
}

export interface CanvasQuizDetail {
  id: number
  title: string
  description: string | null
  time_limit: number | null
  question_count: number
  quiz_type: string
  allowed_attempts: number
  points_possible: number
  due_at: string | null
  show_correct_answers: boolean
  html_url: string
}

export interface CanvasQuizSubmissionData {
  question_id: number
  correct: boolean | null
  points: number
  answer_id?: number
  text?: string
  answer_for_text_entry?: string
}

export interface CanvasQuizSubmission {
  id: number
  quiz_id: number
  score: number | null
  kept_score: number | null
  workflow_state: string
  finished_at: string | null
  attempt: number
  quiz_points_possible: number
  submission_data?: CanvasQuizSubmissionData[]
}

export interface CanvasActiveQuizSubmission {
  id: number
  quiz_id: number
  attempt: number
  validation_token: string
  started_at: string | null
  end_at: string | null
  workflow_state: string
  time_limit: number | null
}

export interface CanvasSubmissionQuestionAnswer {
  id: number
  text: string
  html?: string
  match_id?: number
}

export interface CanvasSubmissionQuestion {
  id: number
  question_name: string
  question_text: string
  question_type: string
  points_possible: number
  answers?: CanvasSubmissionQuestionAnswer[]
  matches?: Array<{ text: string; match_id: number }>
}

export interface CanvasCourseFile {
  id: number
  display_name: string
  filename: string
  'content-type': string
  url: string
  size: number
  updated_at: string
  folder_id: number
  locked: boolean
}

export interface CanvasCourse {
  id: number
  name: string
}

export interface CanvasAssignment {
  name: string
  due_at: string | null
  unlock_at: string | null
  course_id: number
  points_possible: number | null
  html_url: string
  submission?: CanvasSubmission | null
}

export interface CanvasCourseWithGrade {
  id: number
  name: string
  currentScore: number | null
  currentGrade: string | null
}

export interface CanvasSubmission {
  score: number | null
  grade: string | null
  submitted_at: string | null
  workflow_state: string
  late: boolean
  missing: boolean
}

export interface CanvasAssignmentWithSubmission {
  id: number
  name: string
  due_at: string | null
  points_possible: number | null
  html_url: string
  course_id: number
  submission: CanvasSubmission | null
}

// ── Network error codes ──────────────────────────────────────────────────────

const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'])

// ── Internal helpers ─────────────────────────────────────────────────────────

function buildBaseUrl(instanceUrl: string): string {
  return `https://${instanceUrl}`
}

function buildAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function handleAxiosError(err: unknown, instanceUrl: string): never {
  if (err instanceof AxiosError) {
    const code = err.code ?? ''
    const status = err.response?.status

    if (NETWORK_ERROR_CODES.has(code)) {
      logger.warn('Canvas network error', { instanceUrl, errorCode: code })
      throw new CanvasNetworkError(`Cannot reach Canvas instance: ${code}`)
    }

    if (status === 401) {
      logger.warn('Canvas token rejected', { instanceUrl, status })
      throw new CanvasTokenError('Canvas access token is invalid or expired')
    }

    if (status !== undefined) {
      logger.error('Canvas API non-2xx response', { instanceUrl, status })
      throw new CanvasApiError(`Canvas API returned HTTP ${status}`, status)
    }

    logger.error('Canvas request failed', { instanceUrl, errorCode: code, message: err.message })
    throw new CanvasNetworkError(`Canvas request failed: ${err.message}`)
  }

  throw err
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify the Canvas access token by fetching the authenticated user's profile.
 * Throws CanvasTokenError on 401, CanvasNetworkError on connectivity issues.
 */
export async function verifyCanvasToken(instanceUrl: string, token: string): Promise<CanvasSelf> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/users/self`

  logger.info('Verifying Canvas token', { instanceUrl })

  try {
    const response = await axios.get<CanvasSelf>(url, {
      headers: buildAuthHeaders(token),
      timeout: 10_000,
    })

    logger.info('Canvas token verified', { instanceUrl, canvasUserId: response.data.id })
    return response.data
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch active Canvas courses for the authenticated user.
 */
export async function fetchCanvasCourses(instanceUrl: string, token: string): Promise<CanvasCourse[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses?enrollment_state=active&per_page=50`

  logger.info('Fetching Canvas courses', { instanceUrl })

  try {
    const response = await axios.get<CanvasCourse[]>(url, {
      headers: buildAuthHeaders(token),
      timeout: 15_000,
    })

    logger.info('Canvas courses fetched', { instanceUrl, courseCount: response.data.length })
    return response.data
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch upcoming assignments per-course as a fallback.
 * Used when the /users/self/upcoming_assignments endpoint returns 404.
 */
async function fetchAssignmentsFromCourses(
  instanceUrl: string,
  token: string,
  courseIds: number[],
): Promise<CanvasAssignment[]> {
  const assignments: CanvasAssignment[] = []
  const base = buildBaseUrl(instanceUrl)
  const headers = buildAuthHeaders(token)

  for (const courseId of courseIds) {
    try {
      const url = `${base}/api/v1/courses/${courseId}/assignments?bucket=upcoming&include[]=submission&per_page=50&order_by=due_at`
      const res = await axios.get<CanvasAssignment[]>(url, { headers, timeout: 15_000 })
      assignments.push(...res.data)
    } catch {
      logger.warn('Skipping course assignments — fetch failed', { instanceUrl, courseId })
    }
  }

  logger.info('Canvas assignments fetched via per-course fallback', { instanceUrl, assignmentCount: assignments.length })
  return assignments
}

/**
 * Fetch overdue Canvas assignments per-course (past due, within the last 3 months).
 * Canvas has no user-level overdue endpoint, so we must query each course.
 */
export async function fetchCanvasOverdueAssignments(
  instanceUrl: string,
  token: string,
  courseIds: number[],
): Promise<CanvasAssignment[]> {
  const assignments: CanvasAssignment[] = []
  const base = buildBaseUrl(instanceUrl)
  const headers = buildAuthHeaders(token)
  const threeMonthsAgo = new Date(Date.now() - 90 * 86400000)

  for (const courseId of courseIds) {
    try {
      const url = `${base}/api/v1/courses/${courseId}/assignments?bucket=past&include[]=submission&per_page=50&order_by=due_at`
      const res = await axios.get<CanvasAssignment[]>(url, { headers, timeout: 15_000 })
      for (const a of res.data) {
        if (a.due_at && new Date(a.due_at) >= threeMonthsAgo) {
          assignments.push(a)
        }
      }
    } catch {
      logger.warn('Skipping overdue course assignments — fetch failed', { instanceUrl, courseId })
    }
  }

  logger.info('Canvas overdue assignments fetched', { instanceUrl, assignmentCount: assignments.length })
  return assignments
}

/**
 * Fetch active Canvas courses including current score/grade from enrollment data.
 */
export async function fetchCanvasCoursesWithGrades(instanceUrl: string, token: string): Promise<CanvasCourseWithGrade[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses?enrollment_state=active&include[]=total_scores&per_page=50`
  try {
    const response = await axios.get<Array<{
      id: number
      name: string
      enrollments?: Array<{
        type: string
        computed_current_score?: number | null
        computed_current_grade?: string | null
      }>
    }>>(url, { headers: buildAuthHeaders(token), timeout: 15_000 })

    return response.data.map(c => {
      const enroll = c.enrollments?.find(e => e.type === 'student')
      return {
        id: c.id,
        name: c.name,
        currentScore: enroll?.computed_current_score ?? null,
        currentGrade: enroll?.computed_current_grade ?? null,
      }
    })
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch all assignments for a course including the student's submission data.
 */
export async function fetchCanvasAssignmentsWithSubmissions(
  instanceUrl: string,
  token: string,
  courseId: number,
): Promise<CanvasAssignmentWithSubmission[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/assignments?include[]=submission&per_page=100&order_by=due_at`
  try {
    const response = await axios.get<Array<{
      id: number
      name: string
      due_at: string | null
      points_possible: number | null
      html_url: string
      course_id: number
      submission?: CanvasSubmission
    }>>(url, { headers: buildAuthHeaders(token), timeout: 15_000 })

    return response.data.map(a => ({
      id: a.id,
      name: a.name,
      due_at: a.due_at,
      points_possible: a.points_possible,
      html_url: a.html_url,
      course_id: a.course_id,
      submission: a.submission ?? null,
    }))
  } catch {
    logger.warn('Failed to fetch Canvas assignments for course', { instanceUrl, courseId })
    return []
  }
}

/**
 * Fetch the user's Canvas to-do list (assignments due soon).
 */
export async function fetchCanvasTodo(instanceUrl: string, token: string): Promise<CanvasTodoItem[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/users/self/todo?per_page=20`
  try {
    const response = await axios.get<CanvasTodoItem[]>(url, {
      headers: buildAuthHeaders(token),
      timeout: 15_000,
    })
    return response.data
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) return []
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch modules (with items) for a course.
 */
export async function fetchCanvasModules(instanceUrl: string, token: string, courseId: number): Promise<CanvasModule[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/modules?include[]=items&include[]=content_details&per_page=50`
  try {
    const response = await axios.get<CanvasModule[]>(url, {
      headers: buildAuthHeaders(token),
      timeout: 15_000,
    })
    return response.data
  } catch (err) {
    if (err instanceof AxiosError && (err.response?.status === 404 || err.response?.status === 403)) return []
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch announcements for a course.
 */
export async function fetchCanvasAnnouncements(instanceUrl: string, token: string, courseId: number): Promise<CanvasAnnouncement[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=20&order_by=posted_at`
  try {
    const response = await axios.get<CanvasAnnouncement[]>(url, {
      headers: buildAuthHeaders(token),
      timeout: 15_000,
    })
    return response.data
  } catch (err) {
    if (err instanceof AxiosError && (err.response?.status === 404 || err.response?.status === 403)) return []
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch a single assignment's full detail including description and submission.
 */
export async function fetchCanvasAssignmentDetail(
  instanceUrl: string,
  token: string,
  courseId: number,
  assignmentId: number,
): Promise<CanvasAssignmentDetail> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/assignments/${assignmentId}?include[]=submission`
  try {
    const response = await axios.get<CanvasAssignmentDetail>(url, {
      headers: buildAuthHeaders(token),
      timeout: 15_000,
    })
    return response.data
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch files for a course (flat list, most recently updated first).
 */
export async function fetchCanvasCourseFiles(instanceUrl: string, token: string, courseId: number): Promise<CanvasCourseFile[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/files?per_page=50&sort=updated_at&order=desc`
  try {
    const response = await axios.get<CanvasCourseFile[]>(url, {
      headers: buildAuthHeaders(token),
      timeout: 15_000,
    })
    return response.data
  } catch (err) {
    if (err instanceof AxiosError && (err.response?.status === 404 || err.response?.status === 403)) return []
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch a single Canvas page body by slug.
 */
export async function fetchCanvasPage(
  instanceUrl: string,
  token: string,
  courseId: number,
  pageSlug: string,
): Promise<CanvasPage> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageSlug)}`
  try {
    const response = await axios.get<CanvasPage>(url, {
      headers: buildAuthHeaders(token),
      timeout: 15_000,
    })
    return response.data
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch a discussion topic's metadata (title, prompt HTML).
 */
export async function fetchCanvasDiscussionTopic(
  instanceUrl: string, token: string, courseId: number, topicId: number,
): Promise<CanvasDiscussionTopic> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/discussion_topics/${topicId}`
  try {
    const res = await axios.get<CanvasDiscussionTopic>(url, { headers: buildAuthHeaders(token), timeout: 15_000 })
    return res.data
  } catch (err) { handleAxiosError(err, instanceUrl) }
}

/**
 * Fetch all entries/replies in a discussion thread.
 */
export async function fetchCanvasDiscussionView(
  instanceUrl: string, token: string, courseId: number, topicId: number,
): Promise<CanvasDiscussionView> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/discussion_topics/${topicId}/view`
  try {
    const res = await axios.get<CanvasDiscussionView>(url, { headers: buildAuthHeaders(token), timeout: 15_000 })
    return res.data
  } catch (err) { handleAxiosError(err, instanceUrl) }
}

/**
 * Post a new top-level entry or a reply to an existing entry in a discussion.
 */
export async function postCanvasDiscussionEntry(
  instanceUrl: string, token: string, courseId: number, topicId: number,
  message: string, parentEntryId?: number,
): Promise<{ id: number }> {
  const base = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/discussion_topics/${topicId}`
  const url = parentEntryId ? `${base}/entries/${parentEntryId}/replies` : `${base}/entries`
  try {
    const res = await axios.post<{ id: number }>(url, { message }, { headers: buildAuthHeaders(token), timeout: 15_000 })
    return res.data
  } catch (err) { handleAxiosError(err, instanceUrl) }
}

/**
 * Fetch quiz metadata.
 */
export async function fetchCanvasQuizDetail(
  instanceUrl: string, token: string, courseId: number, quizId: number,
): Promise<CanvasQuizDetail> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/quizzes/${quizId}`
  try {
    const res = await axios.get<CanvasQuizDetail>(url, { headers: buildAuthHeaders(token), timeout: 15_000 })
    return res.data
  } catch (err) { handleAxiosError(err, instanceUrl) }
}

/**
 * Fetch questions for a quiz. Canvas only returns answers/weights when the quiz allows it.
 */
export async function fetchCanvasQuizQuestions(
  instanceUrl: string, token: string, courseId: number, quizId: number,
): Promise<CanvasQuizQuestion[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/quizzes/${quizId}/questions?per_page=100`
  try {
    const res = await axios.get<CanvasQuizQuestion[]>(url, { headers: buildAuthHeaders(token), timeout: 15_000 })
    return res.data
  } catch (err) {
    if (err instanceof AxiosError && (err.response?.status === 403 || err.response?.status === 401)) return []
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch the student's quiz submissions including answer data.
 */
export async function fetchCanvasQuizSubmissions(
  instanceUrl: string, token: string, courseId: number, quizId: number,
): Promise<CanvasQuizSubmission[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/quizzes/${quizId}/submissions?include[]=submission_history`
  try {
    const res = await axios.get<{ quiz_submissions: CanvasQuizSubmission[] }>(url, { headers: buildAuthHeaders(token), timeout: 15_000 })
    return res.data.quiz_submissions ?? []
  } catch (err) {
    if (err instanceof AxiosError && (err.response?.status === 403 || err.response?.status === 404)) return []
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Submit an assignment on behalf of the student.
 */
export async function submitCanvasAssignment(
  instanceUrl: string,
  token: string,
  courseId: number,
  assignmentId: number,
  submission: { submission_type: 'online_text_entry' | 'online_url'; body?: string; url?: string },
): Promise<void> {
  const apiUrl = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`
  try {
    await axios.post(apiUrl, { submission }, {
      headers: buildAuthHeaders(token),
      timeout: 20_000,
    })
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Start a new quiz submission attempt for the student.
 * Returns the active submission with a validation_token required for subsequent calls.
 */
export async function startCanvasQuizSubmission(
  instanceUrl: string,
  token: string,
  courseId: number,
  quizId: number,
): Promise<CanvasActiveQuizSubmission> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/quizzes/${quizId}/submissions`
  try {
    const res = await axios.post<{ quiz_submissions: CanvasActiveQuizSubmission[] }>(
      url,
      {},
      { headers: buildAuthHeaders(token), timeout: 20_000 },
    )
    const sub = res.data.quiz_submissions?.[0]
    if (!sub) throw new CanvasApiError('No submission returned from Canvas', 422)
    return sub
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch questions for an active (in-progress) quiz submission.
 * Requires the validation_token from startCanvasQuizSubmission.
 */
export async function fetchCanvasSubmissionQuestions(
  instanceUrl: string,
  token: string,
  courseId: number,
  quizId: number,
  submissionId: number,
  validationToken: string,
): Promise<CanvasSubmissionQuestion[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submissionId}/questions`
  try {
    const res = await axios.get<{ quiz_submission_questions: CanvasSubmissionQuestion[] }>(
      url,
      {
        headers: { ...buildAuthHeaders(token), 'Quiz-Submission-Validation': validationToken },
        timeout: 15_000,
      },
    )
    return res.data.quiz_submission_questions ?? []
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Save (backup) answers for an in-progress quiz submission.
 * quizQuestions is an array of { id: questionId, flagged: boolean, answer: any }
 */
export async function saveCanvasQuizAnswers(
  instanceUrl: string,
  token: string,
  courseId: number,
  quizId: number,
  submissionId: number,
  validationToken: string,
  attempt: number,
  quizQuestions: Array<{ id: number; flagged: boolean; answer: unknown }>,
): Promise<void> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submissionId}/questions`
  try {
    await axios.put(
      url,
      { validation_token: validationToken, attempt, quiz_questions: quizQuestions },
      { headers: buildAuthHeaders(token), timeout: 20_000 },
    )
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Complete (submit) an in-progress quiz submission.
 */
export async function completeCanvasQuizSubmission(
  instanceUrl: string,
  token: string,
  courseId: number,
  quizId: number,
  submissionId: number,
  validationToken: string,
  attempt: number,
): Promise<void> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submissionId}/complete`
  try {
    await axios.post(
      url,
      { attempt, validation_token: validationToken },
      { headers: buildAuthHeaders(token), timeout: 20_000 },
    )
  } catch (err) {
    handleAxiosError(err, instanceUrl)
  }
}

/**
 * Fetch upcoming Canvas assignments for the authenticated user.
 * Tries /users/self/upcoming_assignments first; falls back to per-course
 * fetching if that endpoint returns 404 (not enabled on all Canvas instances).
 */
export async function fetchCanvasUpcomingAssignments(
  instanceUrl: string,
  token: string,
  courseIds: number[],
): Promise<CanvasAssignment[]> {
  const url = `${buildBaseUrl(instanceUrl)}/api/v1/users/self/upcoming_assignments?include[]=submission`

  logger.info('Fetching Canvas upcoming assignments', { instanceUrl })

  try {
    const response = await axios.get<CanvasAssignment[]>(url, {
      headers: buildAuthHeaders(token),
      timeout: 15_000,
    })
    logger.info('Canvas assignments fetched', { instanceUrl, assignmentCount: response.data.length })
    return response.data
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      logger.warn('upcoming_assignments endpoint returned 404 — falling back to per-course fetch', { instanceUrl })
      return fetchAssignmentsFromCourses(instanceUrl, token, courseIds)
    }
    handleAxiosError(err, instanceUrl)
  }
}
