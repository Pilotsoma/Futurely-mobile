export type SystemType = 'HAC' | 'PowerSchool'

export interface NormalizedAssignment {
  name: string
  category: string
  score: number | null
  totalPoints: number | null
  percentage: string
  dateDue: string
}

// Mirrors backend/src/integrations/grades/normalizeGrades.ts NormalizedCourse exactly —
// the shape GET /integrations/grades/current returns for both HAC and PowerSchool.
export interface CurrentGradeCourse {
  id: string
  name: string
  teacher: string
  period: string
  average: number | null
  letterGrade: string | null
  assignments: NormalizedAssignment[]
  upcomingAssignments: NormalizedAssignment[]
}

export interface GpaSummary {
  gpa: number | null
  unweightedGpa: number | null
  weightedGpa: number | null
  courseCount: number
  systemType: SystemType
}

export interface PortalStatus {
  connected: boolean
  systemType: SystemType | null
  districtUrl: string | null
  lastSynced: string | null
  sessionExpiresIn: number
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'complete' | 'error'
  lastSyncedAt: string | null
  errorMessage: 'AUTH_FAILED' | 'UNREACHABLE' | 'SYNC_FAILED' | null
}

export interface HacLoginRequest {
  baseUrl: string
  username: string
  password: string
}

export interface PowerSchoolLoginRequest {
  baseUrl: string
  username: string
  password: string
}

export interface PortalLoginResult {
  sessionToken: string
  systemType: SystemType
  districtUrl: string
  expiresIn: number
}

// The 6 HAC-only endpoints (schedule/info/classwork/report-card/progress-report/
// attendance/contact-teachers) return upstream-scraped, loosely-typed payloads —
// the backend itself types these as `unknown`, so we render them defensively
// rather than pretending a stricter shape exists.
export type RawPortalPayload = Record<string, unknown>

export interface ClassworkClass {
  name?: string
  average?: string | null
  letterGrade?: string | null
  categoryWeights?: unknown
  [key: string]: unknown
}

export interface ClassworkResponse {
  classes: ClassworkClass[]
  availablePeriods: unknown
  currentPeriod: unknown
}
