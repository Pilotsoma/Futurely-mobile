// Grades / school-portal API — wraps /api/integrations/grades/* endpoints.
//
// Endpoint shapes confirmed from backend/src/integrations/grades/gradesRouter.ts:
//
//   POST /api/integrations/grades/hac/login
//     body:  { baseUrl: string (URL), username: string, password: string, clsessionCookie?: string }
//     200:   { data: { sessionToken, systemType: 'HAC', districtUrl, expiresIn } }
//
//   POST /api/integrations/grades/powerschool/login
//     body:  { baseUrl: string (URL), username: string, password: string }
//     200:   { data: { sessionToken, systemType: 'PowerSchool', districtUrl, expiresIn } }
//
//   GET /api/integrations/grades/status
//     200:   { data: { connected: boolean, systemType: string|null, districtUrl: string|null,
//                      lastSynced: string|null, sessionExpiresIn: number } }
//
// Auth: all three require a valid Bearer token (requireAuth middleware).

import { apiGet, apiPost, apiDelete } from './client'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface HacLoginPayload {
  baseUrl: string
  username: string
  password: string
  clsessionCookie?: string
}

export interface PsLoginPayload {
  baseUrl: string
  username: string
  password: string
}

export interface PortalLoginResponse {
  sessionToken: string
  systemType: 'HAC' | 'PowerSchool'
  districtUrl: string
  expiresIn: number
}

export interface PortalStatusResponse {
  connected: boolean
  systemType: string | null
  districtUrl: string | null
  lastSynced: string | null
  sessionExpiresIn: number
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Connect a Home Access Center portal.
 * isScrapingEndpoint=true uses the 45s timeout — HAC login triggers live scraping.
 */
export function hacLogin(
  payload: HacLoginPayload,
  token: string,
): Promise<PortalLoginResponse> {
  return apiPost<PortalLoginResponse>(
    '/integrations/grades/hac/login',
    payload,
    token,
    { isScrapingEndpoint: true },
  )
}

/**
 * Connect a PowerSchool portal.
 * isScrapingEndpoint=true uses the 45s timeout — login triggers live scraping.
 */
export function powerschoolLogin(
  payload: PsLoginPayload,
  token: string,
): Promise<PortalLoginResponse> {
  return apiPost<PortalLoginResponse>(
    '/integrations/grades/powerschool/login',
    payload,
    token,
    { isScrapingEndpoint: true },
  )
}

/**
 * Check whether the current user has a linked school portal.
 * Returns connected=true if a SchoolConnection record exists, even if the
 * in-memory session has expired — see gradesRouter.ts /status handler.
 */
export function portalStatus(token: string): Promise<PortalStatusResponse> {
  return apiGet<PortalStatusResponse>('/integrations/grades/status', token)
}

// ── Dashboard-facing summary endpoints ──────────────────────────────────────────
// Endpoint shapes confirmed from backend/src/integrations/grades/gradesRouter.ts.
// The remaining sub-page endpoints (transcript, schedule, classwork, report-card,
// progress-report, attendance, contact-teachers, info) are added alongside their
// screens rather than here.

export interface CurrentGradeCourse {
  [key: string]: unknown
}

export interface CurrentGradesResponse {
  systemType: 'HAC' | 'PowerSchool'
  grades: CurrentGradeCourse[]
}

/** GET /integrations/grades/current — live current-course grades (2h cache). */
export function getCurrentGrades(token: string): Promise<CurrentGradesResponse> {
  return apiGet<CurrentGradesResponse>('/integrations/grades/current', token, { isScrapingEndpoint: true })
}

export interface GpaResponse {
  gpa: number | null
  unweightedGpa: number | null
  weightedGpa: number | null
  courseCount: number
  systemType: 'HAC' | 'PowerSchool'
}

/** GET /integrations/grades/gpa — computed GPA (weighted/unweighted); 4h cache. */
export function getGpa(token: string): Promise<GpaResponse> {
  return apiGet<GpaResponse>('/integrations/grades/gpa', token, { isScrapingEndpoint: true })
}

export type SyncStatusValue = 'idle' | 'syncing' | 'complete' | 'error'

export interface SyncStatusResponse {
  status: SyncStatusValue
  lastSyncedAt: string | null
  errorMessage: string | null
}

/** GET /integrations/grades/sync-status — poll background sync progress. */
export function getSyncStatus(token: string): Promise<SyncStatusResponse> {
  return apiGet<SyncStatusResponse>('/integrations/grades/sync-status', token)
}

export interface SyncProfileResponse {
  synced: boolean
  systemType?: 'HAC' | 'PowerSchool'
  name?: string | null
  profile: Record<string, unknown> | null
  courseCount?: number
  studentInfo?: {
    name: string | null
    grade: string | null
    school: string | null
    district: string | null
    counselor: string | null
    cohortYear: string | null
  }
}

/**
 * POST /integrations/grades/sync-profile — "universal re-sync": force a fresh
 * relogin with stored credentials and refresh student metadata + GPA. Works for
 * both HAC and PowerSchool connections (not just HAC).
 */
export function syncProfile(token: string): Promise<SyncProfileResponse> {
  return apiPost<SyncProfileResponse>('/integrations/grades/sync-profile', {}, token, { isScrapingEndpoint: true })
}

/**
 * DELETE /integrations/grades/session — disconnect the linked school portal
 * (clears the in-memory session and deletes the SchoolConnection record).
 * Used by Settings' "disconnect portal" action.
 */
export function disconnectPortal(token: string): Promise<{ disconnected: boolean }> {
  return apiDelete<{ disconnected: boolean }>('/integrations/grades/session', undefined, token)
}

// ── Sub-page endpoints ────────────────────────────────────────────────────────
// All of these can trigger live HAC/PS scraping on cache miss, so they use
// { isScrapingEndpoint: true } for the 45s timeout tier.
// Response shapes confirmed from backend/src/integrations/grades/gradesRouter.ts.

// ── Transcript ────────────────────────────────────────────────────────────────

export interface TranscriptSemesterCourse {
  name: string
  grade: string | null
  credits: string | null
  [key: string]: unknown
}

export interface TranscriptSemester {
  period: string | null
  courses: TranscriptSemesterCourse[]
  [key: string]: unknown
}

export interface TranscriptData {
  weightedGPA: string | null
  unweightedGPA: string | null
  classRank: string | null
  totalCredits: string | null
  semesters: TranscriptSemester[]
  [key: string]: unknown
}

export interface TranscriptResponse {
  systemType: string
  transcript: TranscriptData
}

/** GET /integrations/grades/transcript — full academic transcript. 24h cache. */
export function getTranscript(token: string): Promise<TranscriptResponse> {
  return apiGet<TranscriptResponse>('/integrations/grades/transcript', token, { isScrapingEndpoint: true })
}

// ── Schedule ──────────────────────────────────────────────────────────────────
// HAC only — PowerSchool returns 400 with code: 'UNSUPPORTED'.

export interface SchedulePeriod {
  period: string | null
  courseCode: string | null
  courseName: string | null
  teacher: string | null
  room: string | null
  building: string | null
  days: string | null
  [key: string]: unknown
}

export interface ScheduleData {
  courses: SchedulePeriod[]
  [key: string]: unknown
}

export interface ScheduleResponse {
  schedule: ScheduleData
}

/** GET /integrations/grades/schedule — class schedule. HAC only (7d cache). */
export function getSchedule(token: string): Promise<ScheduleResponse> {
  return apiGet<ScheduleResponse>('/integrations/grades/schedule', token, { isScrapingEndpoint: true })
}

// ── Classwork ─────────────────────────────────────────────────────────────────
// HAC only — PowerSchool returns 400 with code: 'UNSUPPORTED'.

export interface ClassworkAssignment {
  name: string | null
  dateDue: string | null
  dateAssigned: string | null
  category: string | null
  score: string | null
  totalPoints: string | null
  weight: string | null
  [key: string]: unknown
}

export interface ClassworkClass {
  name: string
  average: string | null
  period: string | null
  teacher: string | null
  categoryWeights?: Record<string, number> | null
  assignments?: ClassworkAssignment[]
  [key: string]: unknown
}

export interface ClassworkResponse {
  classes: ClassworkClass[]
  availablePeriods?: string[]
  currentPeriod?: string
}

/** GET /integrations/grades/classwork — current classwork. HAC only (2h cache). */
export function getClasswork(token: string, period?: string): Promise<ClassworkResponse> {
  const path = period
    ? `/integrations/grades/classwork?period=${encodeURIComponent(period)}`
    : '/integrations/grades/classwork'
  return apiGet<ClassworkResponse>(path, token, { isScrapingEndpoint: true })
}

// ── Report Card ───────────────────────────────────────────────────────────────
// HAC only — PowerSchool returns 400 with code: 'UNSUPPORTED'.

export interface ReportCardCourse {
  name: string | null
  period: string | null
  teacher: string | null
  grades: Record<string, string | null>
  [key: string]: unknown
}

export interface ReportCardSemester {
  courses: ReportCardCourse[]
  [key: string]: unknown
}

export interface ReportCardResponse {
  reportingPeriods: string[]
  currentPeriod: string | null
  semesters: ReportCardSemester[]
}

/** GET /integrations/grades/report-card — report card. HAC only (6h cache). */
export function getReportCard(token: string, period?: string): Promise<ReportCardResponse> {
  const path = period
    ? `/integrations/grades/report-card?period=${encodeURIComponent(period)}`
    : '/integrations/grades/report-card'
  return apiGet<ReportCardResponse>(path, token, { isScrapingEndpoint: true })
}

// ── Progress Report ───────────────────────────────────────────────────────────
// HAC only — PowerSchool returns 400 with code: 'UNSUPPORTED'.

export interface ProgressReportCourse {
  name: string | null
  period: string | null
  teacher: string | null
  average: string | null
  [key: string]: unknown
}

export interface ProgressReportResponse {
  [key: string]: unknown
}

/** GET /integrations/grades/progress-report — progress report. HAC only (4h cache). */
export function getProgressReport(token: string, date?: string): Promise<ProgressReportResponse> {
  const path = date
    ? `/integrations/grades/progress-report?date=${encodeURIComponent(date)}`
    : '/integrations/grades/progress-report'
  return apiGet<ProgressReportResponse>(path, token, { isScrapingEndpoint: true })
}

// ── Attendance ────────────────────────────────────────────────────────────────
// HAC only — PowerSchool returns 400 with code: 'UNSUPPORTED'.

export interface AttendanceEvent {
  date: string | null
  period: string | null
  courseName: string | null
  absenceType: string | null
  reason: string | null
  [key: string]: unknown
}

export interface AttendanceSummary {
  absences: number | null
  excused: number | null
  tardies: number | null
  [key: string]: unknown
}

export interface AttendanceResponse {
  events?: AttendanceEvent[]
  summary?: AttendanceSummary
  [key: string]: unknown
}

/** GET /integrations/grades/attendance — attendance. HAC only (4h cache). */
export function getAttendance(token: string, monthOffset?: number): Promise<AttendanceResponse> {
  const path = monthOffset !== undefined && monthOffset !== 0
    ? `/integrations/grades/attendance?monthOffset=${monthOffset}`
    : '/integrations/grades/attendance'
  return apiGet<AttendanceResponse>(path, token, { isScrapingEndpoint: true })
}

// ── Contact Teachers ──────────────────────────────────────────────────────────
// HAC only — PowerSchool returns 400 with code: 'UNSUPPORTED'.

export interface TeacherContact {
  name: string | null
  email: string | null
  courseName: string | null
  period: string | null
  [key: string]: unknown
}

export interface ContactTeachersResponse {
  teachers?: TeacherContact[]
  [key: string]: unknown
}

/** GET /integrations/grades/contact-teachers — teacher contacts. HAC only (24h cache). */
export function getContactTeachers(token: string): Promise<ContactTeachersResponse> {
  return apiGet<ContactTeachersResponse>('/integrations/grades/contact-teachers', token, { isScrapingEndpoint: true })
}
