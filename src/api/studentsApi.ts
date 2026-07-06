// Student profile API — wraps /api/students/* endpoints.
//
// Endpoint shapes confirmed from backend/src/routes/students.ts.

import { apiGet, apiPatch } from './client'

export interface CourseGrade {
  letterGrade: string
  percentage: number | null
}

export interface StudentCourse {
  id: number
  name: string
  teacher: string | null
  period: number | null
  courseType: string
  creditHours: number | null
  semester: string | null
  grade: CourseGrade | null
}

export interface StudentAssignmentSummary {
  id: number
  title: string
  subject: string
  dueDate: string
  dueTime: string | null
  completed: boolean
  completedAt: string | null
}

export interface StudentStats {
  totalCourses: number
  completedAssignments: number
  pendingAssignments: number
  assignmentsDueToday: number
  assignmentsDueThisWeek: number
}

export interface StudentProfile {
  satScore: number | null
  actScore: number | null
  futureDecision: string | null
  graduationYear: number | null
  gradeLevel: number | null
  weightedGpa: number
  unweightedGpa: number
}

export interface StudentMe {
  id: number
  email: string
  name: string | null
  role: string
  hasPassword: boolean
  profile: StudentProfile | null
  courses: StudentCourse[]
  assignments: StudentAssignmentSummary[]
  stats: StudentStats
}

// GET /students/me — full profile: user, courses w/ current grades, non-portal assignments, stats.
export function getMe(token: string): Promise<StudentMe> {
  return apiGet<StudentMe>('/students/me', token)
}

export interface UpdateProfilePayload {
  satScore?: number | null
  actScore?: number | null
  futureDecision?: string | null
}

// PATCH /students/me/profile — upsert SAT/ACT scores and future college goal.
export function updateProfile(
  payload: UpdateProfilePayload,
  token: string,
): Promise<StudentProfile> {
  return apiPatch<StudentProfile>('/students/me/profile', payload, token)
}
