/**
 * DOB verification — reconciles a student's self-reported date of birth
 * (collected at signup, stored encrypted in User.dateOfBirth) against the
 * official date of birth pulled from the school's HAC record during a sync
 * (stored encrypted in User.hacDateOfBirth).
 *
 * This is deliberately separate from the COPPA age-gate logic in
 * agentExecution.service.ts (computeAge/consent), which governs whether
 * autonomous AI features require parental consent. This module governs
 * whether the account itself is trustworthy enough to use at all — see
 * evaluateDobVerification() below for the exact match/mismatch/age decision
 * table.
 *
 * Fail-closed per ENGINEERING_RULES.md: any unparsable/undecryptable DOB is
 * treated as a mismatch rather than silently passing verification.
 */

import { AccountStatus } from '@prisma/client'
import { prisma } from './prisma'
import { encryptPassword, decryptPassword } from '../integrations/grades/credentialCrypto'
import { logger } from '../common/logger'

export const MIN_AGE_YEARS = 13
export const MAX_DOB_CORRECTION_ATTEMPTS = 3

// ── Validation (signup input) ─────────────────────────────────────────────────

export interface DobValidationResult {
  ok: boolean
  isoDate?: string
  error?: string
  // Set only when validation failed specifically because the entered DOB
  // computes to under MIN_AGE_YEARS — lets callers return the dedicated
  // COPPA_AGE_GATE error code instead of a generic VALIDATION_ERROR, per
  // COMPLIANCE.md's signup age gate requirement.
  errorCode?: 'COPPA_AGE_GATE' | 'VALIDATION_ERROR'
}

/**
 * Validates a raw date-of-birth string supplied by the user (signup form or
 * the /auth/dob correction endpoint). Expects YYYY-MM-DD or any format
 * `Date` can parse unambiguously. Rejects future dates, unreasonable ages,
 * and — the COPPA gate — anyone who computes to under MIN_AGE_YEARS (13).
 */
export function validateDobInput(raw: unknown): DobValidationResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'Date of birth is required.', errorCode: 'VALIDATION_ERROR' }
  }

  const trimmed = raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { ok: false, error: 'Date of birth must be in YYYY-MM-DD format.', errorCode: 'VALIDATION_ERROR' }
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`)
  if (isNaN(parsed.getTime())) {
    return { ok: false, error: 'Invalid date of birth.', errorCode: 'VALIDATION_ERROR' }
  }

  const now = new Date()
  if (parsed.getTime() > now.getTime()) {
    return { ok: false, error: 'Date of birth cannot be in the future.', errorCode: 'VALIDATION_ERROR' }
  }

  // Fail-closed: if age computation itself throws for any reason, treat as
  // potentially under 13 rather than letting a computation error pass the
  // gate. ageFromDate is a pure arithmetic function and does not currently
  // throw, but this guard keeps the contract explicit per ENGINEERING_RULES.md.
  let age: number
  try {
    age = ageFromDate(parsed, now)
  } catch {
    return { ok: false, error: 'You must be at least 13 to create an account.', errorCode: 'COPPA_AGE_GATE' }
  }

  if (age > 120) {
    return { ok: false, error: 'Please enter a valid date of birth.', errorCode: 'VALIDATION_ERROR' }
  }

  if (age < MIN_AGE_YEARS) {
    return { ok: false, error: 'You must be at least 13 to create an account.', errorCode: 'COPPA_AGE_GATE' }
  }

  return { ok: true, isoDate: trimmed }
}

// ── HAC date parser ───────────────────────────────────────────────────────────

const MONTH_NAME_TO_NUMBER: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

/**
 * Normalizes a raw date string scraped from HAC to ISO "YYYY-MM-DD".
 *
 * Supported formats:
 *   - MM/DD/YYYY and M/D/YYYY (e.g. "01/15/2008", "1/5/2008")
 *   - Month D, YYYY and Month DD, YYYY (e.g. "January 5, 2010", "December 15, 2009")
 *
 * Returns null for anything unparseable, empty, clearly invalid (NaN, out-of-range
 * month/day, year > 150 years ago), or a future date.
 *
 * Pure function — no DB or network access.
 */
export function parseHacDate(raw: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const trimmed = raw.trim()

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10)
    const day   = parseInt(slashMatch[2], 10)
    const year  = parseInt(slashMatch[3], 10)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return isValidIsoDate(iso) ? iso : null
  }

  // Month D, YYYY or Month DD, YYYY (trailing comma optional)
  const monthTextMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (monthTextMatch) {
    const monthNum = MONTH_NAME_TO_NUMBER[monthTextMatch[1].toLowerCase()]
    if (!monthNum) return null
    const day  = parseInt(monthTextMatch[2], 10)
    const year = parseInt(monthTextMatch[3], 10)
    if (day < 1 || day > 31) return null
    const iso = `${year}-${monthNum}-${String(day).padStart(2, '0')}`
    return isValidIsoDate(iso) ? iso : null
  }

  return null
}

/**
 * Validates an ISO date string: must parse to a real calendar date that is not
 * in the future and is not unreasonably far in the past (> 120 years ago).
 */
function isValidIsoDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00.000Z`)
  if (isNaN(d.getTime())) return false
  const now = new Date()
  if (d.getTime() > now.getTime()) return false
  if (ageFromDate(d, now) > 120) return false
  return true
}

// ── Encryption helpers ─────────────────────────────────────────────────────────
// Thin wrappers around the shared credential cipher so callers never import
// credentialCrypto directly for DOB fields — keeps the encryption key usage
// auditable to one call site per concern.

export function encryptDob(isoDate: string): string {
  return encryptPassword(isoDate)
}

export function decryptDob(ciphertext: string): string {
  return decryptPassword(ciphertext)
}

// ── Age / comparison ─────────────────────────────────────────────────────────

function ageFromDate(birth: Date, now: Date): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1
  }
  return age
}

/**
 * Computes age in years from an encrypted DOB ciphertext. Throws on any
 * decrypt/parse failure — callers must treat that as a hard block, never a
 * fallback age (fail-closed, matching computeAge() in agentExecution.service.ts).
 */
export function ageFromEncryptedDob(encryptedDob: string): number {
  const plaintext = decryptDob(encryptedDob)
  const birth = new Date(plaintext)
  if (isNaN(birth.getTime())) {
    throw new Error('Invalid date of birth format after decryption')
  }
  return ageFromDate(birth, new Date())
}

/**
 * Returns the calendar date the given DOB ciphertext turns MIN_AGE_YEARS old.
 */
export function dateOfMinAge(encryptedDob: string): Date {
  const plaintext = decryptDob(encryptedDob)
  const birth = new Date(plaintext)
  if (isNaN(birth.getTime())) {
    throw new Error('Invalid date of birth format after decryption')
  }
  const turns13 = new Date(birth)
  turns13.setUTCFullYear(birth.getUTCFullYear() + MIN_AGE_YEARS)
  return turns13
}

/**
 * Compares two encrypted DOB ciphertexts for an exact calendar-date match
 * (year/month/day) after decryption. Returns false (not a match) if either
 * value fails to decrypt/parse — fail-closed.
 */
export function doDobsMatch(encryptedA: string, encryptedB: string): boolean {
  try {
    const a = new Date(decryptDob(encryptedA))
    const b = new Date(decryptDob(encryptedB))
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return false
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    )
  } catch {
    return false
  }
}

// ── Verification decision ────────────────────────────────────────────────────

export interface DobVerificationResult {
  status: AccountStatus
  ageYears: number | null
  bannedUntilDate: Date | null
}

/**
 * Decides the account status once a HAC-sourced DOB is available to compare
 * against the self-reported signup DOB. HAC is the ground truth for age.
 *
 * - Match                                           -> ACTIVE (self-report was
 *   truthful, and signup already enforced 13+ at that time)
 * - Mismatch, and the HAC-confirmed age is < 13      -> UNDER_13_BANNED. This is
 *   the COPPA-evasion case: the student self-reported an age that got them
 *   past the 13+ signup gate, but the school's record shows they're actually
 *   under 13. Banned until their HAC-confirmed 13th birthday.
 * - Mismatch, but the HAC-confirmed age is >= 13     -> DOB_MISMATCH_LOCKED.
 *   Not a COPPA issue (they're old enough either way) — just an unverified
 *   identity that needs the student to correct their self-reported DOB.
 * - Either value fails to decrypt/parse              -> DOB_MISMATCH_LOCKED
 *   (fail closed rather than trusting an unverifiable value)
 */
export function evaluateDobVerification(params: {
  selfReportedDobEncrypted: string
  hacDobEncrypted: string
}): DobVerificationResult {
  const { selfReportedDobEncrypted, hacDobEncrypted } = params

  if (doDobsMatch(selfReportedDobEncrypted, hacDobEncrypted)) {
    let ageYears: number
    try {
      ageYears = ageFromEncryptedDob(hacDobEncrypted)
    } catch {
      // Matched but unparsable is not expected (match already required both
      // to parse), but stay fail-closed regardless.
      return { status: AccountStatus.DOB_MISMATCH_LOCKED, ageYears: null, bannedUntilDate: null }
    }
    return { status: AccountStatus.ACTIVE, ageYears, bannedUntilDate: null }
  }

  // Mismatch — HAC is ground truth for age. If it can't be read, fail closed
  // to the (non-COPPA) locked state rather than guessing at a ban.
  let ageYears: number
  try {
    ageYears = ageFromEncryptedDob(hacDobEncrypted)
  } catch {
    return { status: AccountStatus.DOB_MISMATCH_LOCKED, ageYears: null, bannedUntilDate: null }
  }

  if (ageYears < MIN_AGE_YEARS) {
    return {
      status: AccountStatus.UNDER_13_BANNED,
      ageYears,
      bannedUntilDate: dateOfMinAge(hacDobEncrypted),
    }
  }

  return { status: AccountStatus.DOB_MISMATCH_LOCKED, ageYears, bannedUntilDate: null }
}

// ── Ban expiry ────────────────────────────────────────────────────────────────

export interface LiftedBanResult {
  accountStatus: AccountStatus
  bannedUntilDate: Date | null
}

/**
 * Checks whether a user currently sits in UNDER_13_BANNED with an elapsed
 * bannedUntilDate, and if so, atomically lifts the ban to DOB_MISMATCH_LOCKED
 * (never straight to ACTIVE — the self-reported DOB that caused the ban was
 * still false, so a correction via PATCH /auth/dob is still owed) with an
 * audit log entry in the same transaction.
 *
 * Called from every endpoint the frontend polls for account status (GET
 * /auth/me, GET /auth/account-status) as well as requireActiveAccount, since
 * those routes are deliberately exempt from that middleware and must not show
 * a stale ban forever once it has expired.
 *
 * Returns the user's current (possibly just-updated) status. Fail-open is not
 * possible here by construction — if no ban is active or it hasn't expired,
 * the passed-in status/date are simply echoed back unchanged.
 */
export async function liftExpiredBanIfNeeded(
  userId: number,
  currentStatus: AccountStatus,
  currentBannedUntilDate: Date | null,
  ipAddress: string,
): Promise<LiftedBanResult> {
  if (currentStatus !== AccountStatus.UNDER_13_BANNED) {
    return { accountStatus: currentStatus, bannedUntilDate: currentBannedUntilDate }
  }
  if (!currentBannedUntilDate || currentBannedUntilDate.getTime() > Date.now()) {
    return { accountStatus: currentStatus, bannedUntilDate: currentBannedUntilDate }
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { accountStatus: AccountStatus.DOB_MISMATCH_LOCKED, bannedUntilDate: null },
    }),
    prisma.complianceAuditLog.create({
      data: {
        userId,
        resourceType: 'user_identity',
        resourceId: String(userId),
        action: 'COPPA_BAN_LIFTED',
        ipAddress,
      },
    }),
  ])
  logger.info('account.ban_lifted_to_dob_locked', { userId })

  return { accountStatus: AccountStatus.DOB_MISMATCH_LOCKED, bannedUntilDate: null }
}
