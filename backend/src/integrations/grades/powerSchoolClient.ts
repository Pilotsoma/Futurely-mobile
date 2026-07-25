/**
 * PowerSchool SIS scraping client.
 * Adapted from https://github.com/ruskcoder/gradexis-api (powerschool/ folder).
 * All Gradexis-specific branding removed.
 */
import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import { saveSession, getSessionByToken, StoredSession } from './sessionStore'

export interface PSClass {
  name: string
  grade: string | null
  term: string
}

export interface PSStudentInfo {
  name: string
  district: string
  school: string
}

// ── Session helpers ────────────────────────────────────────────────────────────

function makeAxiosSession() {
  const jar = new CookieJar()
  return {
    jar,
    http: wrapper(
      axios.create({
        withCredentials: true,
        jar,
        timeout: 20_000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
    ),
  }
}

function restoreSession(stored: StoredSession) {
  const jar = CookieJar.fromJSON(JSON.parse(stored.sessionData)) as CookieJar
  const http = wrapper(
    axios.create({
      withCredentials: true,
      jar,
      timeout: 20_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
    })
  )
  return { jar, http }
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url : url + '/'
}

// ── Auth ───────────────────────────────────────────────────────────────────────

/**
 * Log in to a PowerSchool SIS instance.
 * @param baseUrl  e.g. "https://ps.mydistrict.edu/"
 * @param username Portal username
 * @param password Portal password (never stored)
 * @param userId NextStep user ID
 * @returns sessionToken
 */
export async function loginPowerSchool(
  baseUrl: string,
  username: string,
  password: string,
  userId: number
): Promise<string> {
  const link = normalizeBaseUrl(baseUrl)
  const { jar, http } = makeAxiosSession()

  const loginUrl = `${link}guardian/home.html`

  // Fetch login page first to get any hidden form fields
  let loginPage: string
  try {
    const res = await http.get(loginUrl)
    loginPage = res.data as string
  } catch {
    throw new Error(`Could not reach PowerSchool at ${baseUrl} — check the district URL`)
  }

  const $ = cheerio.load(loginPage)
  const pstoken = $("input[name='pstoken']").val() as string | undefined
  const contextData = $("input[name='contextData']").val() as string | undefined

  const formData = new URLSearchParams({
    account: username,
    pw: password,
    dbpw: password,
    ldappassword: password,
    serviceName: 'PS Parent Portal',
    credentialType: 'User Id and Password Credential',
    request_locale: 'en_US',
  })
  if (pstoken) formData.set('pstoken', pstoken)
  if (contextData) formData.set('contextData', contextData)

  let loginResponse: string
  try {
    const res = await http.post(loginUrl, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 10,
    })
    loginResponse = res.data as string
  } catch {
    throw new Error('Login request failed — network error')
  }

  // Detect invalid credentials
  if (loginResponse.includes('Invalid') || loginResponse.includes('invalid') || loginResponse.includes('LogOn')) {
    throw new Error('Invalid credentials — login was rejected by PowerSchool')
  }

  const sessionToken = saveSession(userId, 'PowerSchool', link, JSON.stringify(jar.toJSON()))
  return sessionToken
}

// ── Data fetchers ──────────────────────────────────────────────────────────────

export async function getGrades(sessionToken: string): Promise<PSClass[]> {
  const stored = getSessionByToken(sessionToken)
  if (!stored) throw new Error('School session expired or not found — please log in again')

  const { http } = restoreSession(stored)
  const link = stored.baseUrl

  const res = await http.get(`${link}guardian/home.html`)
  const $ = cheerio.load(res.data as string)

  const termHeaders: string[] = []
  $('.linkDescList thead tr th').each((_i, th) => {
    const text = $(th).text().trim()
    if (text.length === 2) termHeaders.push(text) // Term codes are 2 chars e.g. "Q1"
  })

  const classes: PSClass[] = []
  $('.linkDescList tbody tr').each((_i, row) => {
    const cells = $(row).find('td')
    const name = cells.eq(0).find('a').text().trim() || cells.eq(0).text().trim()
    if (!name) return
    // Pick the most recent non-empty grade
    let grade: string | null = null
    for (let c = cells.length - 1; c >= 1; c--) {
      const g = cells.eq(c).text().trim()
      if (g && g !== '--') { grade = g; break }
    }
    const term = termHeaders[cells.length - 2] ?? ''
    classes.push({ name, grade, term })
  })

  return classes
}

export async function getTranscript(sessionToken: string): Promise<object> {
  const stored = getSessionByToken(sessionToken)
  if (!stored) throw new Error('School session expired or not found — please log in again')

  const { http } = restoreSession(stored)
  const link = stored.baseUrl

  // PowerSchool transcript is on the main grades page — return all term data
  const res = await http.get(`${link}guardian/home.html`)
  const $ = cheerio.load(res.data as string)

  const termHeaders: string[] = []
  $('.linkDescList thead tr th').each((_i, th) => {
    termHeaders.push($(th).text().trim())
  })

  const rows: object[] = []
  $('.linkDescList tbody tr').each((_i, row) => {
    const entry: Record<string, string> = {}
    $(row).find('td').each((j, td) => {
      if (termHeaders[j]) entry[termHeaders[j]] = $(td).text().trim()
    })
    rows.push(entry)
  })

  return { terms: termHeaders, courses: rows }
}
