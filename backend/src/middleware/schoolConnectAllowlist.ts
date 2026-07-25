import { Request } from 'express'

/**
 * Paths that must remain reachable regardless of account status
 * (requireActiveAccount) or missing consent (requireConsent).
 *
 * These are matched against req.method + req.baseUrl + req.path, since
 * Express strips the mount prefix before passing req.path to middleware:
 * a request to POST /integrations/grades/hac/login arrives at middleware
 * mounted via app.use('/integrations/grades', ..., router) with
 * req.baseUrl === '/integrations/grades' and req.path === '/hac/login'.
 *
 * WHY THIS EXISTS — the deadlock: both requireActiveAccount and
 * requireConsent are applied ahead of the grades and classlink integration
 * routers. A DOB_MISMATCH_LOCKED account — most commonly an OAuth signup,
 * which lands in that state with neither a school connection nor recorded
 * ToS/Privacy consent — has no other way to obtain a hacDateOfBirth value
 * to verify against, and no other way to record consent from within a
 * locked session, than by calling these exact endpoints. Blocking them
 * creates an unresolvable loop: connecting a school portal is blocked by
 * requireConsent (no consent recorded yet) and requireActiveAccount
 * (account not ACTIVE yet), and neither of those can ever be satisfied
 * without connecting a school portal.
 *
 * This list is shared by both middlewares so they can't drift out of sync —
 * exempting a route from one but not the other reproduces the same
 * deadlock in a different order (confirmed in production: a fresh OAuth
 * account could reach the connect-school screen, but the actual connect
 * request was silently rejected by requireConsent, bounced the user to the
 * ToS modal, and — because the connection was never created — asked them
 * to enter their school portal credentials a second time after agreeing).
 *
 * Only these specific connect/login routes are exempted. All data-reading
 * endpoints (transcript, gpa, schedule, classwork, etc.) remain fully
 * blocked for locked/banned or unconsented accounts; the intent is "you
 * may connect your school portal and record consent to attempt to resolve
 * your lock, but you may not use the rest of the app." Do not expand this
 * list without an explicit architecture review.
 *
 * baseUrl is included (not just path) so this stays scoped to the exact
 * router each entry belongs to — matching on path alone would silently
 * exempt any future unrelated `POST /connect` route added to some other
 * router either middleware also guards, which would be a real
 * access-control regression, not just a naming accident.
 */
const SCHOOL_CONNECT_ALLOWLIST: ReadonlyArray<{ method: string; baseUrl: string; path: string }> = [
  { method: 'POST', baseUrl: '/integrations/grades', path: '/hac/login' },
  { method: 'POST', baseUrl: '/integrations/grades', path: '/powerschool/login' },
  { method: 'POST', baseUrl: '/integrations/classlink', path: '/connect' },
]

export function isSchoolConnectAllowlisted(req: Request): boolean {
  return SCHOOL_CONNECT_ALLOWLIST.some(
    (entry) => req.method === entry.method && req.baseUrl === entry.baseUrl && req.path === entry.path,
  )
}
