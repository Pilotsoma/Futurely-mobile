import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { calculateGpa, GradeInput } from '../lib/gpa'

const router = Router()

interface GradeSummary {
  letterGrade: string
  percentage: number
  gradingPeriod: string
}

interface CourseResponse {
  id: number
  name: string
  teacher: string
  period: number
  courseType: string
  creditHours: number
  semester: string
  grade: GradeSummary | null
}

router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userId === undefined) {
    res.status(401).json({
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    })
    return
  }

  try {
    const rawCourses = await prisma.course.findMany({
      where: { userId: req.userId },
      include: {
        grades: {
          where: { gradingPeriod: 'CURRENT' },
          take: 1,
        },
      },
      orderBy: { period: 'asc' },
    })

    const courses: CourseResponse[] = rawCourses.map(c => {
      const g = c.grades.length > 0 ? c.grades[0] : null
      return {
        id: c.id,
        name: c.name,
        teacher: c.teacher,
        period: c.period,
        courseType: c.courseType,
        creditHours: c.creditHours,
        semester: c.semester,
        grade: g !== null
          ? { letterGrade: g.letterGrade, percentage: g.percentage, gradingPeriod: g.gradingPeriod }
          : null,
      }
    })

    const gpaInputs: GradeInput[] = rawCourses
      .filter(c => c.grades.length > 0)
      .map(c => ({
        letterGrade: c.grades[0].letterGrade,
        creditHours: c.creditHours,
        courseType: c.courseType,
      }))

    const gpa = calculateGpa(gpaInputs)

    res.json({ data: { gpa, courses } })
  } catch {
    res.status(500).json({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  }
})

export default router
