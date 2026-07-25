import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { ASSIGNMENT_SOURCE } from '../src/constants/assignmentSource'

const prisma = new PrismaClient()

const SEMESTER = '2025-FA'

interface CourseDef {
  name: string
  teacher: string
  period: number
  courseType: string
  creditHours: number
  letterGrade: string
  percentage: number
}

const COURSES: CourseDef[] = [
  { name: 'AP English Language', teacher: 'Ms. Rivera',    period: 1, courseType: 'AP',       creditHours: 1.0, letterGrade: 'A-', percentage: 92.0 },
  { name: 'AP Calculus BC',      teacher: 'Mr. Johnson',   period: 2, courseType: 'AP',       creditHours: 1.0, letterGrade: 'B+', percentage: 88.0 },
  { name: 'U.S. History',        teacher: 'Mr. Williams',  period: 3, courseType: 'STANDARD', creditHours: 1.0, letterGrade: 'A',  percentage: 95.0 },
  { name: 'Spanish III',         teacher: 'Sra. Martinez', period: 4, courseType: 'STANDARD', creditHours: 1.0, letterGrade: 'B',  percentage: 83.0 },
  { name: 'Honors Chemistry',    teacher: 'Dr. Patel',     period: 5, courseType: 'HONORS',   creditHours: 1.0, letterGrade: 'B+', percentage: 87.0 },
  { name: 'Physical Education',  teacher: 'Coach Davis',   period: 6, courseType: 'STANDARD', creditHours: 1.0, letterGrade: 'A',  percentage: 98.0 },
]

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: 'test@nextstep.com' },
    update: {},
    create: {
      email: 'test@nextstep.com',
      passwordHash: await bcrypt.hash('nextstep123', 10),
      name: 'Test Student',
      role: 'STUDENT',
    },
  })

  await prisma.assignment.deleteMany({ where: { userId: user.id } })
  const userCourses = await prisma.course.findMany({ where: { userId: user.id }, select: { id: true } })
  await prisma.grade.deleteMany({ where: { courseId: { in: userCourses.map(c => c.id) } } })
  await prisma.course.deleteMany({ where: { userId: user.id } })

  for (const def of COURSES) {
    const course = await prisma.course.create({
      data: {
        userId: user.id,
        name: def.name,
        teacher: def.teacher,
        period: def.period,
        semester: SEMESTER,
        courseType: def.courseType,
        creditHours: def.creditHours,
      },
    })

    await prisma.grade.create({
      data: {
        courseId: course.id,
        userId: user.id,
        letterGrade: def.letterGrade,
        percentage: def.percentage,
        gradingPeriod: 'CURRENT',
      },
    })
  }

  function due(offsetDays: number): Date {
    const d = new Date()
    d.setDate(d.getDate() + offsetDays)
    d.setHours(23, 59, 0, 0)
    return d
  }

  interface AssignmentDef {
    title: string
    subject: string
    dueDate: Date
    estimatedMinutes: number
  }

  const ASSIGNMENTS: AssignmentDef[] = [
    // Overdue
    { title: 'Problem Set 7 — Integration by Parts',         subject: 'AP Calculus BC',       dueDate: due(-3),  estimatedMinutes: 90  },
    { title: 'Hamlet Act IV Essay Draft',                    subject: 'AP English Language',  dueDate: due(-1),  estimatedMinutes: 120 },
    // Due today
    { title: 'Cell Division Lab Report',                     subject: 'Honors Chemistry',     dueDate: due(0),   estimatedMinutes: 60  },
    { title: 'WWII Primary Source Analysis',                 subject: 'U.S. History',         dueDate: due(0),   estimatedMinutes: 45  },
    // Due tomorrow
    { title: 'Verb Conjugation Quiz Prep — Subjunctive Mood', subject: 'Spanish III',         dueDate: due(1),   estimatedMinutes: 30  },
    // This week
    { title: 'Recursion Practice Problems',                  subject: 'AP Calculus BC',       dueDate: due(3),   estimatedMinutes: 75  },
    { title: 'Battle of Midway — Cause & Effect Analysis',   subject: 'U.S. History',         dueDate: due(5),   estimatedMinutes: 90  },
    // Later
    { title: 'Final Exam Study Guide',                       subject: 'AP Calculus BC',       dueDate: due(14),  estimatedMinutes: 180 },
    { title: 'College Essay Rough Draft',                    subject: 'AP English Language',  dueDate: due(10),  estimatedMinutes: 120 },
  ]

  await prisma.assignment.createMany({
    data: ASSIGNMENTS.map(a => ({
      userId: user.id,
      title: a.title,
      subject: a.subject,
      dueDate: a.dueDate,
      estimatedMinutes: a.estimatedMinutes,
      source: ASSIGNMENT_SOURCE.SEED,
    })),
  })
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
