#!/usr/bin/env npx tsx
/**
 * HAC debug harness — login once, fetch every problem page, dump HTML + analysis.
 *
 * Prerequisites:
 *   Fill in backend/.env:
 *     HAC_TEST_DISTRICT_URL="https://homeaccess.katyisd.org/HomeAccess/Account/LogOn"
 *     HAC_TEST_USERNAME="K2008105"
 *     HAC_TEST_PASSWORD="your-password"
 *
 * Usage (from backend/ directory):
 *   npx tsx scripts/debug-hac.ts
 *
 * Output:
 *   debug_classwork.html, debug_schedule.html, debug_ipr.html, debug_attendance.html
 *   (written to backend/ directory, same location the backend writes them at runtime)
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'

const BASE_URL = (process.env.HAC_TEST_DISTRICT_URL ?? '').trim()
const USERNAME  = (process.env.HAC_TEST_USERNAME  ?? '').trim()
const PASSWORD  = (process.env.HAC_TEST_PASSWORD  ?? '').trim()

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.error('\nERROR: Missing HAC credentials in backend/.env')
  console.error('  Set HAC_TEST_DISTRICT_URL, HAC_TEST_USERNAME, HAC_TEST_PASSWORD')
  process.exit(1)
}

// Resolve output dir to backend/ (two levels up from backend/scripts/)
const OUT_DIR = path.resolve(__dirname, '..')

function getOrigin(url: string): string {
  try {
    const u = new URL(url.trim())
    return `${u.protocol}//${u.host}/`
  } catch {
    const m = url.trim().match(/^(https?:\/\/[^/?#]+)/)
    return m ? `${m[1]}/` : url
  }
}

function dumpHtml(label: string, html: string): void {
  const file = path.join(OUT_DIR, `debug_${label}.html`)
  fs.writeFileSync(file, html, 'utf8')
  console.log(`  [dump] ${file}  (${html.length.toLocaleString()} bytes)`)
}

function analyze(label: string, html: string): void {
  const $ = cheerio.load(html)
  console.log(`\n━━━ ${label.toUpperCase()} ━━━`)
  console.log(`  Tables total:        ${$('table').length}`)
  console.log(`  .sg-asp-data-rows:   ${$('.sg-asp-table-data-row, tr.sg-asp-table-data-row').length}`)
  console.log(`  .AssignmentClass:    ${$('.AssignmentClass').length}`)

  // iframe detection
  const iframeSrc = $('iframe#sg-legacy-iframe, #sg-legacy-iframe, iframe[id*="legacy"]').attr('src')
    ?? $('iframe').first().attr('src')
  console.log(`  Iframe detected:     ${iframeSrc ? `YES → ${iframeSrc}` : 'none'}`)

  // Select dropdowns
  $('select').each((i, sel) => {
    const id   = $(sel).attr('id') ?? `select[${i}]`
    const opts = $(sel).find('option').map((_, o) => $(o).text().trim()).get().join(' | ')
    if (opts) console.log(`  SELECT #${id}:  ${opts.slice(0, 200)}`)
  })

  // Specific elements
  const checks: Array<[string, string]> = [
    ['[id*="ddlIPRDates"]',      'IPR date dropdown'],
    ['[id*="ddlRCRuns"]',        'RC period dropdown'],
    ['[id*="lbPrev"]',           'Prev-month link'],
    ['[id*="lbNext"]',           'Next-month link'],
    ['[id*="lblMonthYear"]',     'Month/year label'],
    ['[id*="lblMonthYear"] + *', 'Month/year sibling'],
    ['[id*="CumGPA"]',           'Cumulative GPA span'],
    ['[id*="lblCumGPA"]',        'CumGPA label'],
  ]
  for (const [sel, desc] of checks) {
    const els = $(sel)
    if (els.length > 0) {
      console.log(`  ✓ ${desc}  (${sel}):  "${els.first().text().trim().slice(0, 100)}"`)
    }
  }

  // Column headers from first header row
  const headerRow = $('tr.sg-asp-table-header-row, thead tr').first()
  if (headerRow.length > 0) {
    const ths = headerRow.find('th, td').map((_, th) => `"${$(th).text().trim()}"`).get()
    console.log(`  Header cols:  [${ths.join(', ')}]`)
  }

  // First data row
  const dataRow = $('tr.sg-asp-table-data-row').first()
  if (dataRow.length > 0) {
    const cells = dataRow.find('td').map((_, td) => `"${$(td).text().trim().slice(0, 30)}"`).get()
    console.log(`  First data row: [${cells.join(', ')}]`)
  }

  // First table text preview
  const firstTable = $('table').first()
  if (firstTable.length > 0) {
    const preview = firstTable.text().replace(/\s+/g, ' ').trim().slice(0, 300)
    console.log(`  Table[0] preview: "${preview}"`)
  }
}

type AxiosHttp = ReturnType<typeof wrapper>

async function followIframe(
  http: AxiosHttp,
  outerUrl: string,
  outerHtml: string,
): Promise<{ html: string; iframeUrl: string | null }> {
  const $ = cheerio.load(outerHtml)
  const src = $('iframe#sg-legacy-iframe, #sg-legacy-iframe, iframe[id*="legacy"], iframe[src*="Content"]').attr('src')
  if (!src) return { html: outerHtml, iframeUrl: null }

  const iframeUrl = src.startsWith('http') ? src : new URL(src, outerUrl).toString()
  console.log(`  Following iframe → ${iframeUrl}`)
  await new Promise(r => setTimeout(r, 500))
  const res = await http.get(iframeUrl, {
    headers: { Referer: outerUrl, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  })
  return { html: res.data as string, iframeUrl }
}

async function main(): Promise<void> {
  const origin = getOrigin(BASE_URL)
  console.log(`\nHAC Debug Harness`)
  console.log(`  Origin:   ${origin}`)
  console.log(`  Username: ${USERNAME}`)
  console.log(`  Out dir:  ${OUT_DIR}\n`)

  // ── Create axios session ──────────────────────────────────────────────────
  const jar = new CookieJar()
  const client = axios.create({
    withCredentials: true,
    jar,
    timeout: 45_000,
    maxRedirects: 10,
    validateStatus: (s: number) => s >= 200 && s < 500,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  const http = wrapper(client)

  // ── Login ────────────────────────────────────────────────────────────────
  const loginPageUrl = /Account\/Log[Oo]n/.test(BASE_URL)
    ? BASE_URL.trim()
    : `${origin}HomeAccess/Account/LogOn`

  console.log(`Step 1: Fetching login page`)
  console.log(`  URL: ${loginPageUrl}`)
  const loginRes = await http.get(loginPageUrl)
  const $ = cheerio.load(loginRes.data as string)

  const verificationToken = $("input[name='__RequestVerificationToken']").val() as string | undefined
  if (!verificationToken) {
    console.error('\nERROR: No __RequestVerificationToken on login page')
    console.error('  Page title:', $('title').text().trim())
    process.exit(1)
  }

  const formData = new URLSearchParams()
  $('form input').each((_, input) => {
    const name  = $(input).attr('name')
    const value = $(input).attr('value') ?? ''
    if (name) formData.set(name, value)
  })
  formData.set('__RequestVerificationToken', verificationToken)
  formData.set('VerificationOption', 'UsernamePassword')
  formData.set('LogOnDetails.UserName',  USERNAME)
  formData.set('LogOnDetails.Password',  PASSWORD)
  formData.set('LogOnDetails_UserName',  USERNAME)
  formData.set('LogOnDetails_Password',  PASSWORD)
  if (!formData.has('Database')) formData.set('Database', '10')

  const loginAction    = $('form').first().attr('action') ?? loginPageUrl
  const loginPostUrl   = new URL(loginAction, loginPageUrl).toString()

  console.log(`Step 2: Posting login form`)
  console.log(`  POST → ${loginPostUrl}`)
  const postRes = await http.post(loginPostUrl, formData.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: origin.replace(/\/$/, ''),
      Referer: loginPageUrl,
    },
  })
  const postFinalUrl = (postRes.request as { res?: { responseUrl?: string } })?.res?.responseUrl ?? loginPostUrl
  console.log(`  Redirected to: ${postFinalUrl}`)

  const cookies = jar.getCookiesSync(origin.replace(/\/$/, ''))
  const hasAuth  = cookies.some(c =>
    c.key === '.ASPXAUTH' ||
    c.key.toLowerCase().includes('aspxauth') ||
    c.key === 'ASP.NET_SessionId' ||
    c.key.toLowerCase().includes('session')
  )
  console.log(`  Cookies: [${cookies.map(c => c.key).join(', ')}]  hasAuth=${hasAuth}`)

  if (!hasAuth) {
    console.error('\nERROR: Login failed — no auth cookie set')
    process.exit(1)
  }
  console.log('\n  ✓ LOGIN OK\n')

  // ── Fetch pages ───────────────────────────────────────────────────────────
  const pages: Array<{ label: string; url: string }> = [
    { label: 'classwork',  url: `${origin}HomeAccess/Classes/Classwork` },
    { label: 'schedule',   url: `${origin}HomeAccess/Classes/Schedule` },
    { label: 'ipr',        url: `${origin}HomeAccess/Grades/IPR` },
    { label: 'attendance', url: `${origin}HomeAccess/Attendance/MonthView` },
  ]

  for (const page of pages) {
    console.log(`\nFetching ${page.label}: ${page.url}`)
    try {
      const res = await http.get(page.url, {
        headers: { Referer: `${origin}HomeAccess/Home.aspx` },
      })
      const outerHtml = res.data as string
      const { html, iframeUrl } = await followIframe(http, page.url, outerHtml)

      if (iframeUrl) {
        dumpHtml(`${page.label}_outer`, outerHtml)
        dumpHtml(page.label, html)
      } else {
        dumpHtml(page.label, html)
      }
      analyze(page.label, html)
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`)
    }

    await new Promise(r => setTimeout(r, 700))
  }

  console.log('\n✓ Debug harness complete')
  console.log(`  Review debug_*.html files in: ${OUT_DIR}\n`)
}

main().catch(e => {
  console.error('\nFATAL ERROR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
