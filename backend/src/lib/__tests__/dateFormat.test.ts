import { formatDueDateForPreview } from '../dateFormat'

// An instant that is "Jul 17" in America/New_York (UTC-4 in summer) but
// "Jul 18" in UTC: 2026-07-18T01:30:00.000Z  →  Jul 17 9:30 PM Eastern
const CROSS_DAY_INSTANT = new Date('2026-07-18T01:30:00.000Z')

describe('formatDueDateForPreview', () => {
  it('returns the local calendar date when a valid IANA timezone is supplied', () => {
    const result = formatDueDateForPreview(CROSS_DAY_INSTANT, 'America/New_York')
    // 2026-07-18T01:30Z is 2026-07-17 21:30 Eastern — preview must say "Jul 17"
    expect(result).toBe('Jul 17')
  })

  it('returns the UTC calendar date when no timezone is supplied', () => {
    const result = formatDueDateForPreview(CROSS_DAY_INSTANT)
    // Without a timezone the fallback is UTC — 2026-07-18T01:30Z → "Jul 18"
    expect(result).toBe('Jul 18')
  })

  it('falls back to UTC formatting when an invalid IANA zone string is supplied', () => {
    // Invalid zone should not throw — it should fall back gracefully to UTC
    const result = formatDueDateForPreview(CROSS_DAY_INSTANT, 'Not/A_Real_Zone')
    expect(result).toBe('Jul 18')
  })

  it('returns the UTC calendar date when an empty-string timezone bypasses the min(1) guard (edge case)', () => {
    // The Zod schema enforces min(1), so an empty string never reaches the util
    // in production. Test the util directly to confirm it treats '' as absent.
    const result = formatDueDateForPreview(CROSS_DAY_INSTANT, '')
    // '' is falsy — the ?? 'UTC' branch fires — so we get UTC formatting
    expect(result).toBe('Jul 18')
  })

  it('formats a date correctly in a positive-offset timezone', () => {
    // 2026-07-17T22:00:00Z is Jul 18 00:00 in Europe/Paris (UTC+2 in summer)
    const instant = new Date('2026-07-17T22:00:00.000Z')
    const result = formatDueDateForPreview(instant, 'Europe/Paris')
    expect(result).toBe('Jul 18')
  })
})
