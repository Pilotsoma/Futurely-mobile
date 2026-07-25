// Run with: npx ts-node src/integrations/grades/testHacLogin.ts
import 'dotenv/config'
import { loginHAC } from './hacClient'

async function main() {
  const username = process.env.HAC_TEST_USERNAME
  const password = process.env.HAC_TEST_PASSWORD

  if (!username || !password) {
    console.error('❌ HAC_TEST_USERNAME and HAC_TEST_PASSWORD must be set in backend/.env')
    process.exit(1)
  }

  try {
    const token = await loginHAC(
      'https://homeaccess.katyisd.org',
      username,
      password,
      999,
    )
    console.log('✅ Login successful. Session token:', token)
  } catch (err) {
    console.error('❌ Login failed:', err)
    process.exit(1)
  }
}

main()
