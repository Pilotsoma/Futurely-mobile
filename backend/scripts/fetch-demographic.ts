#!/usr/bin/env npx tsx
/**
 * Quick script to fetch the HAC Demographic page and dump the HTML
 * so we can inspect the counselor/graduation year selectors.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'

const BASE_URL = (process.env.HAC_TEST_DISTRICT_URL ?? '').trim()
const USERNAME = (process.env.HAC_TEST_USERNAME ?? '').trim()
const PASSWORD = (process.env.HAC_TEST_PASSWORD ?? '').trim()

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.error('\nERROR: Missing HAC credentials in backend/.env')
  console.error('  Set HAC_TEST_DISTRICT_URL, HAC_TEST_USERNAME, HAC_TEST_PASSWORD')
  process.exit(1)
}

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

async function main() {
  const origin = getOrigin(BASE_URL)
  console.log(`\nFetching Demographic page`)
  console.log(`  Origin: ${origin}`)
  console.log(`  Username: ${USERNAME}\n`)

  const jar = new CookieJar()
  const client = axios.create({
    withCredentials: true, jar,
    timeout: 45_000, maxRedirects: 10,
    validateStatus: (s: number) => s >= 200 && s < 500,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  const http = wrapper(client)

  // Login
  const loginPageUrl = /Account\/Log[Oo]n/.test(BASE_URL) ? BASE_URL.trim() : `${origin}HomeAccess/Account/LogOn`
  const loginRes = await http.get(loginPageUrl)
  const $login = cheerio.load(loginRes.data as string)
  const vt = $login("input[name='__RequestVerificationToken']").val() as string | undefined
  if (!vt) { console.error('No verification token'); process.exit(1) }

  const form = new URLSearchParams()
  $login('form input').each((_, input) => {
    const name = $login(input).attr('name')
    const value = $login(input).attr('value') ?? ''
    if (name) form.set(name, value)
  })
  form.set('__RequestVerificationToken', vt)
  form.set('VerificationOption', 'UsernamePassword')
  form.set('LogOnDetails.UserName', USERNAME)
  form.set('LogOnDetails.Password', PASSWORD)
  form.set('LogOnDetails_UserName', USERNAME)
  form.set('LogOnDetails_Password', PASSWORD)
  if (!form.has('Database')) form.set('Database', '10')

  const formAction = $login('form').first().attr('action') ?? loginPageUrl
  const postUrl = new URL(formAction, loginPageUrl).toString()
  await http.post(postUrl, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin.replace(/\/$/, ''), Referer: loginPageUrl },
  })

  const cookies = jar.getCookiesSync(origin.replace(/\/$/, ''))
  const hasAuth = cookies.some(c => c.key === '.ASPXAUTH' || c.key.toLowerCase().includes('aspxauth') || c.key === 'ASP.NET_SessionId')
  console.log(`  Login: ${hasAuth ? 'OK' : 'FAILED'}\n`)

  if (!hasAuth) process.exit(1)

  // Fetch Demographic page (shell with iframe)
  const demoUrl = `${origin}HomeAccess/Registration/Demographic`
  console.log(`Fetching: ${demoUrl}`)
  const res = await http.get(demoUrl, { headers: { Referer: `${origin}HomeAccess/Home.aspx` } })
  const outerHtml = res.data as string

  // Check for iframe and fetch its content
  const $outer = cheerio.load(outerHtml)
  const iframeSrc = $outer('iframe.sg-legacy-iframe, iframe[id*="legacy"], iframe[src*="Registration"], iframe[src*="Student"]').attr('src')
  let html = outerHtml

  if (iframeSrc) {
    const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, demoUrl).toString()
    console.log(`  Found iframe: ${iframeUrl}`)
    const iframeRes = await http.get(iframeUrl, { headers: { Referer: demoUrl } })
    if (typeof iframeRes.data === 'string' && iframeRes.data.length > 200) {
      html = iframeRes.data
      console.log(`  Iframe content: ${html.length.toLocaleString()} bytes`)
    }
  }

  // Save full HTML
  const outFile = path.join(OUT_DIR, 'debug_demographic.html')
  fs.writeFileSync(outFile, html, 'utf8')
  console.log(`  Wrote ${outFile} (${html.length.toLocaleString()} bytes)`)

  // Parse and analyze
  const $ = cheerio.load(html)

  console.log('\n━━━ ALL SPAN IDs with text ━━━')
  $('span[id]').each((_, el) => {
    const id = $(el).attr('id') ?? ''
    const text = $(el).text().trim()
    if (text) console.log(`  #${id} = "${text.slice(0, 100)}"`)
  })

  console.log('\n━━━ ALL LABELS ━━━')
  $('label').each((_, el) => {
    const text = $(el).text().trim()
    const forAttr = $(el).attr('for') ?? ''
    if (text) console.log(`  label[for="${forAttr}"] = "${text}"`)
  })

  console.log('\n━━━ Body text containing "counselor" or "cohort" ━━━')
  const bodyText = $('body').text()
  const lines = bodyText.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (/counselor|cohort|graduation|rank|quartile/i.test(trimmed)) {
      console.log(`  "${trimmed.slice(0, 120)}"`)
    }
  }

  console.log('\n━━━ All table rows with text ━━━')
  $('tr').each((_, row) => {
    const cells = $(row).find('td')
    if (cells.length >= 2) {
      const texts = cells.map((_, c) => $(c).text().trim().slice(0, 60)).get()
      if (texts.some(t => /counselor|cohort|graduation|grade|name|school|district/i.test(t))) {
        console.log(`  [${texts.join(' | ')}]`)
      }
    }
  })

  console.log('\nDone.')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })