import type { Assignment } from './assignments'

export interface StudentProfile {
  id: number
  userId: number
  gradeLevel: number
  graduationYear: number | null
  weightedGpa: number
  unweightedGpa: number
  futureDecision: string | null
  satScore: number | null
  actScore: number | null
  counselorName: string | null
}

export interface StudentCourseGrade {
  letterGrade: string
  percentage: number | null
}

export interface StudentCourse {
  id: number
  name: string
  teacher: string | null
  period: string | null
  courseType: string
  creditHours: number | null
  semester: string | null
  grade: StudentCourseGrade | null
}

export interface StudentStats {
  totalCourses: number
  completedAssignments: number
  pendingAssignments: number
  assignmentsDueToday: number
  assignmentsDueThisWeek: number
}

export interface StudentMe {
  id: number
  email: string
  name: string | null
  role: string
  hasPassword: boolean
  profile: StudentProfile | null
  courses: StudentCourse[]
  assignments: Assignment[]
  stats: StudentStats
}

export interface UpdateProfileRequest {
  satScore?: number | null
  actScore?: number | null
  futureDecision?: string | null
}
