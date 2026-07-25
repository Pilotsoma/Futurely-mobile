import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const students = await prisma.studentProfile.findMany({
    take: 20,
    orderBy: { weightedGpa: 'desc' },
    include: { user: true },
  })

  console.log('\n=== TOP 20 DEMO STUDENTS (by weighted GPA) ===\n')
  console.log('Email                    | Name                  | Grade | W.GPA | U.GPA')
  console.log('-------------------------|----------------------|-------|-------|------')
  for (const s of students) {
    const email = s.user.email.padEnd(24)
    const name = (s.user.name ?? '').padEnd(21)
    console.log(`${email} | ${name} | ${s.gradeLevel}     | ${s.weightedGpa.toFixed(2)}  | ${s.unweightedGpa.toFixed(2)}`)
  }
  console.log('\nPassword for all: nextstep123')
  console.log('Test account: test@nextstep.com / nextstep123\n')
}

main().finally(() => prisma.$disconnect())
