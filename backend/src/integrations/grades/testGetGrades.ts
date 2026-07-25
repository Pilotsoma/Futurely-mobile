/**
 * Quick test to fetch HAC grades using a session token and dump the HTML for analysis.
 *
 * Usage:
 *   cd backend && npx ts-node src/integrations/grades/testGetGrades.ts <sessionToken>
 *
 * If no token provided, it will first do a fresh login and then fetch grades.
 */
import 'dotenv/config'
import { loginHAC, getGrades } from './hacClient'
import { saveSession, getSessionByUserId, saveSessionWithPersistence } from './sessionStore'

async function main() {
  const username = process.env.HAC_TEST_USERNAME
  const password = process.env.HAC_TEST_PASSWORD

  if (!username || !password) {
    console.error('❌ HAC_TEST_USERNAME and HAC_TEST_PASSWORD must be set in backend/.env')
    process.exit(1)
  }

  let token = process.argv[2] // optional session token arg

  if (!token) {
    console.log('🔄 No token provided, logging in first...')
    token = await loginHAC(
      'https://homeaccess.katyisd.org',
      username,
      password,
      999,
    )
    console.log('✅ Login successful. Token:', token)
  } else {
    console.log('🔑 Using provided token:', token)
  }

  console.log('\n📥 Fetching grades...')
  try {
    const { classes: grades, availablePeriods, currentPeriod } = await getGrades(token)
    console.log('\n✅ Grades fetched successfully!')
    console.log(`📅 Periods available: ${availablePeriods.join(', ') || 'none'} (current: ${currentPeriod})`)
    console.log(`📚 Found ${grades.length} classes:\n`)

    if (grades.length === 0) {
      console.log('(No classes parsed - the HTML selectors may not match)')
      console.log('Check hac_classwork_debug.html for the raw HTML')
    } else {
      grades.forEach((cls, i: number) => {
        console.log(`  ${i + 1}. ${cls.name}`)
        console.log(`     Teacher: ${cls.teacher}`)
        console.log(`     Period: ${cls.period}`)
        console.log(`     Average: ${cls.average ?? 'N/A'}`)
        console.log(`     Assignments: ${cls.scores.length}`)
        if (cls.scores.length > 0) {
          cls.scores.slice(0, 3).forEach((s: { name: string; score: number | null; totalPoints: number | null; percentage: string }) => {
            console.log(`       - ${s.name}: ${s.score ?? '?'}/${s.totalPoints ?? '?'} (${s.percentage})`)
          })
          if (cls.scores.length > 3) console.log(`       ... and ${cls.scores.length - 3} more`)
        }
        console.log()
      })

      const totalScores = grades.reduce((sum: number, c: { scores: unknown[] }) => sum + c.scores.length, 0)
      console.log(`📊 Summary: ${grades.length} classes, ${totalScores} total assignments`)
    }
  } catch (err) {
    console.error('\n❌ Failed to fetch grades:', err)
    process.exit(1)
  }

  // Also check if the debug HTML was saved
  const fs = require('fs')
  if (fs.existsSync('hac_classwork_debug.html')) {
    const size = fs.statSync('hac_classwork_debug.html').size
    console.log(`\n📄 hac_classwork_debug.html saved (${size} bytes)`)
  }
}

main().catch(console.error)