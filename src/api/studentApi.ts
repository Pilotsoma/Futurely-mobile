import { apiFetch } from '../utils/api'

export interface StudentProfile {
  id: number
  studentId: string
  gradeLevel: number
  graduationYear: number
  futureDecision: string | null
  satScore: number | null
  actScore: number | null
  counselorName: string | null
  weightedGpa: number
  unweightedGpa: number
}

export interface CourseWithGrade {
  id: number
  name: string
  teacher: string
  period: number
  courseType: string
  creditHours: number
  semester: string
  grade: { letterGrade: string; percentage: number } | null
}

export interface Assignment {
  id: number
  title: string
  subject: string
  dueDate: string
  estimatedMinutes: number
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

export interface StudentData {
  id: number
  email: string
  name: string | null
  role: string
  profile: StudentProfile | null
  courses: CourseWithGrade[]
  assignments: Assignment[]
  stats: StudentStats
}

interface StudentApiResponse {
  data: StudentData
}

export async function fetchStudentData(): Promise<StudentData> {
  const res = await apiFetch<StudentApiResponse>('/students/me')
  return res.data
}
