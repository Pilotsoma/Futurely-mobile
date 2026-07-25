/**
 * Safe server-side date formatter that respects a caller-supplied IANA timezone.
 *
 * Problem: Node.js (and Vercel's runtime) runs in UTC. Calling
 * `date.toLocaleDateString()` without an explicit `timeZone` option formats in
 * the *server's* timezone (UTC), not the student's local timezone. For a due
 * date of "9:47 PM Eastern (UTC-4)" the UTC wall-clock date is already the next
 * calendar day, so the notification preview would say "Jul 18" instead of "Jul 17".
 *
 * Fix: accept the client's IANA timezone string and pass it to `Intl.DateTimeFormat`
 * via `toLocaleDateString`'s `timeZone` option. Fall back to `'UTC'` when:
 *   - no timezone was supplied (older client, agent-created assignment), or
 *   - the string is not a valid IANA zone (`Intl` throws `RangeError`).
 *
 * The fallback to UTC matches the pre-fix behaviour, so existing consumers that
 * don't send a timezone see no regression.
 */
export function formatDueDateForPreview(date: Date, timezone?: string): string {
  const tz = timezone ?? 'UTC'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: tz }
  try {
    return date.toLocaleDateString('en-US', opts)
  } catch {
    // Invalid IANA zone — fall back to UTC rather than crashing the request
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
}
