import { apiFetch } from '../utils/api'

export interface GradeData {
  letterGrade: string
  percentage: number
  gradingPeriod: string
}

export interface AssignmentDetail {
  name: string
  category: string
  score: number | null
  totalPoints: number | null
  percentage: string
  dateDue: string
}

export interface CourseWithGrade {
  id: number
  name: string
  teacher: string
  period: number
  courseType: string
  creditHours: number
  semester: string
  grade: GradeData | null
  assignments: AssignmentDetail[]
}

export interface GpaData {
  weighted: number
  unweighted: number
}

interface GradesApiResponse {
  data: {
    gpa: GpaData | null
    courses: CourseWithGrade[]
  }
}

export async function fetchGrades(): Promise<GradesApiResponse['data']> {
  const res = await apiFetch<GradesApiResponse>('/grades')
  return res.data
}
