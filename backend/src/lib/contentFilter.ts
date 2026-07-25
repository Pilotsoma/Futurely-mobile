// Content filter for usernames, posts, and comments.
//
// Three detection layers applied in sequence:
//
//  Layer 1 — Leet-speak normalisation
//    "sh1t" → "shit", "@ss" → "ass", "n1gg3r" → "nigger",
//    "ni99er" → "nigger" (9→g), "5lut" → "slut", etc.
//
//  Layer 2 — Word-anchored spaced-pattern match
//    Each word compiles to: \bf[^a-z0-9]*u[^a-z0-9]*c[^a-z0-9]*k
//    The \b prevents "ass" from matching inside "classic" or "grasshopper".
//    Any separator (space, dot, dash, underscores, symbols…) between the
//    target letters is allowed, so "f u c k", "f.u.c.k", "f-u-c-k" are caught.
//    Only non-alphanumeric chars can serve as separators — so "flick" never
//    triggers the "fck" entry ("l" breaks the match).
//
//  Layer 3 — Compressed-text substring check
//    Strip ALL non-alphanumeric characters (including spaces) from the text
//    and run a substring check against every blocked word that is 5+ chars.
//    This catches the "missing-letter + space" trick:
//      "nig er"  → compress → "niger"  → hits "niger"  entry ✓
//      "nig ger" → compress → "nigger" → hits "nigger" entry ✓
//    Exception: "niger" entry uses a negative lookahead (?!ia) so that
//    "Nigeria" / "Nigerian" do NOT get blocked.

const BLOCKED: readonly string[] = [
  // ── Profanity: base + common bypass forms ────────────────────────────────
  'fuck', 'fck', 'fuk', 'fuq', 'fxck', 'fk', 'fku',
  'shit', 'sht', 'shyt', 'shiit',
  'bitch', 'btch', 'bich', 'biatch', 'bith', 'bih', 'btc',
  'cunt', 'cnt', 'cvnt',
  'dick', 'dck', 'dik', 'dih',
  'cock', 'cck', 'cok',
  'pussy', 'pssy', 'pvssy',
  'ass', 'asshole', 'azzhole', 'ahole',
  'bastard', 'bstrd',
  'piss',
  'prick',
  'slut', 'slt', 'slvt',
  'whore', 'whor', 'whr', 'whre',
  'twat',
  'wanker', 'wnkr',
  'bollocks',
  'arse', 'arsehole',
  // ── Abbreviations / internet slang bypasses ──────────────────────────────
  'smd',   // suck my dick
  'stfu',  // shut the fuck up
  // ── Slurs: base + 1-deletion + consonant-skeleton forms ──────────────────
  'nigger', 'nigga',
  'nig',    // standalone slur fragment
  'nigg',   // "nig g", "n i g g" — catches partial spelling with separator
  'niger',  // "nig er", "n i g e r" (negative lookahead protects "Nigeria")
  'nigr',   // typed consonant skeleton
  'niggr',  // "nigg r" — missing vowel form
  'ngger',  // "n!g!g!e!r" with '!' used as separator
  'ngr',    // bare consonant run
  'faggot', 'fggot', 'fggrt', 'fagot',
  'fgg',
  'fag',
  'dyke', 'dyk',
  'tranny', 'trny',
  'retard', 'rtrd', 'retrd',
  'chink', 'chnk',
  'spic', 'spick',
  'kike',
  'wetback',
  'towelhead',
  'raghead',
  'gook',
  'beaner', 'bnr',
  // ── Sexual / explicit ────────────────────────────────────────────────────
  'sex', 'sexy', 'sexting', 'sext',
  'blowjob', 'handjob', 'cumshot',
  'cum', 'jizz',
  'masturbat',
  'porn', 'pr0n',
  'hentai',
  'dildo', 'vibrator',
  'nude', 'nudity', 'nudes',
  'naked',
  'boob', 'boobs', 'boobies',
  'tit', 'tits', 'titty', 'titties',
  'hooters',
  'penis', 'vagina', 'genitals',
  'erection',
  'orgasm',
  'rape', 'rapist',
  'molest',
  'pedophile', 'paedophile', 'pedo', 'pedo',
  'grooming',
  // ── Homophobic / identity-based slurs ────────────────────────────────────
  // Note: "gay" is added per app policy — LGBTQ+ students may be affected.
  'gay',
  'homo',
  'lesbian',
  // ── Threats / self-harm ──────────────────────────────────────────────────
  'kill yourself',
  'kill urself',
  'kys',
  'go die',
  'end yourself',
] as const

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Layer 1: leet normalisation — preserves spaces so layer-2 spaced patterns
// still work on "f u c k" style input.
function leetNorm(text: string): string {
  return text
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/6/g, 'b')
    .replace(/7/g, 't')
    .replace(/9/g, 'g')   // "ni99er" → "nigger"
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/\|/g, 'i')
    .replace(/\+/g, 't')
    .replace(/\\/g, 'l')
    // Collapse 3+ identical consecutive chars ("fuuuck" → "fuuck")
    .replace(/(.)\1{2,}/g, '$1$1')
}

// Words that get \b at BOTH ends — short words where the pattern is likely
// to appear as a substring of innocent longer words (sex→sexuality, ass→classic,
// cum→curriculum, gay→okay, tit→title…).  All other words use \b only at the
// start so derived forms ("fucking", "pornographic") are still caught.
const FULL_BOUNDARY = new Set([
  'sex', 'sext', 'ass', 'cum', 'fag', 'tit', 'gay', 'kys', 'ngr', 'fgg', 'dyk', 'bnr',
  // New short forms — must be standalone words to avoid false positives
  'fk', 'fku', 'btc', 'bith', 'bih', 'dih', 'smd', 'stfu', 'nig',
])

// Layer 2: spaced patterns.
// \b at the start anchors to a word boundary so that e.g. "ass" does not
// match inside "classic" or "grasshopper" (where 'a' is mid-word).
const SPACED_PATTERNS: RegExp[] = BLOCKED.map(word => {
  if (word.includes(' ')) {
    return new RegExp(escRe(word), 'i')
  }
  const letters = [...word].filter(c => /[a-z]/i.test(c))
  const body = letters.map(escRe).join('[^a-z0-9]*')
  // Protect "Nigeria" / "Nigerian": don't block "niger" when followed by "i…a"
  // Separators between i and a are allowed so "n i g e r i a" also passes.
  const suffix = word === 'niger'
    ? '(?![^a-z0-9]*i[^a-z0-9]*a)'
    : FULL_BOUNDARY.has(word) ? '\\b' : ''
  return new RegExp('\\b' + body + suffix, 'i')
})

// Layer 3: compressed-text patterns for words 5+ chars.
// "niger" gets a negative lookahead so "nigeria"/"nigerian" are not blocked.
const COMPRESSED_PATTERNS: RegExp[] = BLOCKED
  .filter(w => !w.includes(' ') && w.length >= 5)
  .map(w => {
    const escaped = escRe(w)
    // Protect "Nigeria" / "Nigerian" — don't block when "niger" is followed by "ia"
    const pattern = w === 'niger' ? `${escaped}(?!ia)` : escaped
    return new RegExp(pattern, 'i')
  })

export interface FilterResult {
  ok: boolean
  reason?: string
}

export function filterContent(text: string): FilterResult {
  const normed = leetNorm(text)

  // Layer 2 — word-anchored spaced patterns
  for (const p of SPACED_PATTERNS) {
    if (p.test(normed)) {
      return { ok: false, reason: 'Content contains inappropriate language' }
    }
  }

  // Layer 3 — compressed substring check
  const compressed = normed.replace(/[^a-z0-9]/g, '')
  for (const p of COMPRESSED_PATTERNS) {
    if (p.test(compressed)) {
      return { ok: false, reason: 'Content contains inappropriate language' }
    }
  }

  return { ok: true }
}

// Reserved names — stripped to lowercase alphanumeric for comparison so
// leet-speak variants like "Futur3ly", "adm1n", or "off1cial" are also blocked.
const RESERVED_NAMES: readonly string[] = [
  // Brand — old name (still blocked to prevent legacy impersonation)
  'futurely', 'futurly', 'futurley',
  // Brand — new name (blocked to prevent impersonation after rebrand)
  'myfuturely', 'myfuturly', 'myfuturley',
  // Staff / authority roles
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support',
  'official', 'team', 'owner', 'ceo', 'founder',
  // System / bot — old brand compounds
  'system', 'bot', 'robot', 'automated', 'futurelybot', 'futurelyteam',
  'futurelyofficial', 'futurelystaff', 'futurelymod', 'futurelysupport',
  // System / bot — new brand compounds
  'myfuturleybot', 'myfuturleyteam',
  'myfuturleyofficial', 'myfuturleystaff', 'myfuturleymod', 'myfuturleysupport',
  // Dev roles
  'dev', 'developer', 'devteam',
]

export function filterUsername(name: string): FilterResult {
  const trimmed = name.trim()
  if (trimmed.length < 2) {
    return { ok: false, reason: 'Name must be at least 2 characters' }
  }
  if (trimmed.length > 30) {
    return { ok: false, reason: 'Name must be 30 characters or fewer' }
  }

  // Reserved name check — normalize to lowercase alphanumeric only
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const reserved of RESERVED_NAMES) {
    if (normalized === reserved || normalized.startsWith(reserved) || normalized.endsWith(reserved)) {
      return { ok: false, reason: 'That name is reserved and cannot be used' }
    }
  }

  return filterContent(trimmed)
}

// ── Repeat-violation auto-mute tracker ───────────────────────────────────────
// Tracks how many times a user has attempted to post blocked content within a
// rolling 15-minute window. On the 3rd violation, the caller should mute them
// for 1 hour. State is in-memory (resets on server restart) which is fine —
// the mute itself is persisted in the database.

const VIOLATION_WINDOW_MS  = 15 * 60 * 1000  // 15 minutes
const VIOLATION_THRESHOLD  = 3

interface ViolationRecord { count: number; windowStart: number }
const violationTracker = new Map<number, ViolationRecord>()

export function recordViolation(userId: number): { shouldMute: boolean } {
  const now = Date.now()
  const rec = violationTracker.get(userId)

  if (!rec || now - rec.windowStart > VIOLATION_WINDOW_MS) {
    violationTracker.set(userId, { count: 1, windowStart: now })
    return { shouldMute: false }
  }

  rec.count++
  if (rec.count >= VIOLATION_THRESHOLD) {
    violationTracker.delete(userId)
    return { shouldMute: true }
  }

  return { shouldMute: false }
}
