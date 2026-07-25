import { prisma } from './prisma'

const PATCHES: string[] = [
  // ── User columns ─────────────────────────────────────────────────────
  `ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "hacName"                  TEXT,
    ADD COLUMN IF NOT EXISTS "coins"                    INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lastCoinClaim"            TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "nameColor"                TEXT,
    ADD COLUMN IF NOT EXISTS "avatarEffect"             TEXT,
    ADD COLUMN IF NOT EXISTS "avatarUrl"                TEXT,
    ADD COLUMN IF NOT EXISTS "ownedNameColors"          JSONB        NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS "ownedAvatarEffects"       JSONB        NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS "allTags"                  JSONB        NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS "loginStreak"              INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "marketplaceAccess"        BOOLEAN      NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "lastSeenAt"               TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "chatBanned"               BOOLEAN      NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "marketplaceBanned"        BOOLEAN      NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "chatMutedUntil"           TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "failedLoginAttempts"      INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lockedUntil"              TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "emailVerified"            BOOLEAN      NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "emailVerificationToken"   TEXT,
    ADD COLUMN IF NOT EXISTS "emailVerificationExpiry"  TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedAt"                TIMESTAMP(3)`,

  // ALTER COLUMN must be its own statement
  `ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL`,

  // ── Post columns ─────────────────────────────────────────────────────
  `ALTER TABLE "Post"
    ADD COLUMN IF NOT EXISTS "type"                TEXT  NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN IF NOT EXISTS "giveawayTag"         TEXT,
    ADD COLUMN IF NOT EXISTS "giveawayTagColor"    TEXT,
    ADD COLUMN IF NOT EXISTS "giveawayCoinAmount"  INTEGER,
    ADD COLUMN IF NOT EXISTS "giveawayEndsAt"      TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "giveawayWinnerId"    INTEGER,
    ADD COLUMN IF NOT EXISTS "giveawayItemType"    TEXT,
    ADD COLUMN IF NOT EXISTS "giveawayItemId"      TEXT,
    ADD COLUMN IF NOT EXISTS "giveawayItemRarity"  TEXT,
    ADD COLUMN IF NOT EXISTS "unboxItemType"       TEXT,
    ADD COLUMN IF NOT EXISTS "unboxItemId"         TEXT,
    ADD COLUMN IF NOT EXISTS "unboxItemName"       TEXT,
    ADD COLUMN IF NOT EXISTS "unboxItemValue"      TEXT,
    ADD COLUMN IF NOT EXISTS "unboxItemRarity"     TEXT,
    ADD COLUMN IF NOT EXISTS "unboxItemEstValue"   INTEGER,
    ADD COLUMN IF NOT EXISTS "unboxItemTagColor"   TEXT,
    ADD COLUMN IF NOT EXISTS "pinnedUntil"         TIMESTAMP(3)`,

  // ── Unique constraint on User.name ───────────────────────────────────
  // Deduplicate only if duplicates actually exist (avoids a full table scan every cold start).
  `DO $$ BEGIN
    IF EXISTS (
      SELECT 1 FROM "User" WHERE name IS NOT NULL
      GROUP BY name HAVING COUNT(*) > 1 LIMIT 1
    ) THEN
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY id) AS rn
        FROM "User" WHERE name IS NOT NULL
      )
      UPDATE "User" SET name = NULL FROM ranked
      WHERE "User".id = ranked.id AND ranked.rn > 1;
    END IF;
  END $$`,

  // IF NOT EXISTS avoids the AccessExclusiveLock when the constraint already exists.
  `ALTER TABLE "User" ADD CONSTRAINT IF NOT EXISTS "User_name_key" UNIQUE ("name")`,

  // ── Tables ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "GiveawayEntry" (
    "id"        SERIAL PRIMARY KEY,
    "postId"    INTEGER NOT NULL REFERENCES "Post"("id") ON DELETE CASCADE,
    "userId"    INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiveawayEntry_postId_userId_key" UNIQUE ("postId", "userId")
  )`,
  `CREATE TABLE IF NOT EXISTS "CommentLike" (
    "id"        SERIAL PRIMARY KEY,
    "commentId" INTEGER NOT NULL REFERENCES "Comment"("id") ON DELETE CASCADE,
    "userId"    INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommentLike_commentId_userId_key" UNIQUE ("commentId", "userId")
  )`,
  `CREATE TABLE IF NOT EXISTS "OAuthAccount" (
    "id"         SERIAL PRIMARY KEY,
    "userId"     INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "provider"   TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "email"      TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAccount_provider_providerId_key" UNIQUE ("provider", "providerId")
  )`,
  `CREATE TABLE IF NOT EXISTS "EmailOTP" (
    "id"        SERIAL PRIMARY KEY,
    "email"     TEXT NOT NULL,
    "codeHash"  TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // ── Spin stats columns ───────────────────────────────────────────────
  `ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "spinCoinsSpent"  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "spinTotalSpins"  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "spinCommon"      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "spinUncommon"    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "spinRare"        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "spinEpic"        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "spinLegendary"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "spinMythic"      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "spinCurse"       INTEGER NOT NULL DEFAULT 0`,

  // ── ToS/Privacy/age consent columns ──────────────────────────────────
  `ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "tosAcceptedAt"     TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "privacyAcceptedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "ageConfirmedAt"    TIMESTAMP(3)`,

  // ── Assignment start date (multi-day calendar spans) ─────────────────
  `ALTER TABLE "Assignment"
    ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3)`,

  // ── COPPA / agentic-consent columns on User ───────────────────────────
  // dateOfBirth and coppaParentEmail stored as AES-256-GCM ciphertext.
  `ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "dateOfBirth"                 TEXT,
    ADD COLUMN IF NOT EXISTS "coppaConsentStatus"          TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    ADD COLUMN IF NOT EXISTS "coppaConsentTimestamp"       TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "coppaParentEmail"            TEXT,
    ADD COLUMN IF NOT EXISTS "autonomousConsentAcceptedAt" TIMESTAMP(3)`,

  // ── AutonomousAgentJob (must come before AgentSession due to FK) ──────
  `CREATE TABLE IF NOT EXISTS "AutonomousAgentJob" (
    "id"           SERIAL PRIMARY KEY,
    "userId"       INTEGER REFERENCES "User"("id"),
    "module"       TEXT NOT NULL,
    "triggerType"  TEXT NOT NULL,
    "triggerEvent" TEXT,
    "scheduledAt"  TIMESTAMP(3) NOT NULL,
    "executedAt"   TIMESTAMP(3),
    "status"       TEXT NOT NULL DEFAULT 'PENDING',
    "result"       JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "AutonomousAgentJob_status_scheduledAt_idx"
    ON "AutonomousAgentJob"("status", "scheduledAt")`,
  `CREATE INDEX IF NOT EXISTS "AutonomousAgentJob_userId_module_idx"
    ON "AutonomousAgentJob"("userId", "module")`,

  // ── AgentSession ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "AgentSession" (
    "id"              SERIAL PRIMARY KEY,
    "userId"          INTEGER NOT NULL REFERENCES "User"("id"),
    "module"          TEXT NOT NULL,
    "trigger"         TEXT NOT NULL,
    "status"          TEXT NOT NULL,
    "toolCallCount"   INTEGER NOT NULL DEFAULT 0,
    "maxToolCalls"    INTEGER NOT NULL DEFAULT 12,
    "userMessage"     TEXT,
    "finalResponse"   TEXT,
    "autonomousJobId" INTEGER REFERENCES "AutonomousAgentJob"("id"),
    "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"     TIMESTAMP(3),
    "errorMessage"    TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "AgentSession_userId_module_startedAt_idx"
    ON "AgentSession"("userId", "module", "startedAt")`,
  `CREATE INDEX IF NOT EXISTS "AgentSession_status_startedAt_idx"
    ON "AgentSession"("status", "startedAt")`,

  // ── AgentToolCall ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "AgentToolCall" (
    "id"           SERIAL PRIMARY KEY,
    "sessionId"    INTEGER NOT NULL REFERENCES "AgentSession"("id"),
    "toolName"     TEXT NOT NULL,
    "toolInput"    JSONB NOT NULL,
    "toolOutput"   JSONB,
    "status"       TEXT NOT NULL,
    "denialReason" TEXT,
    "executedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs"   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS "AgentToolCall_sessionId_idx"
    ON "AgentToolCall"("sessionId")`,
  `CREATE INDEX IF NOT EXISTS "AgentToolCall_toolName_executedAt_idx"
    ON "AgentToolCall"("toolName", "executedAt")`,

  // ── AgentWriteRateLimit ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "AgentWriteRateLimit" (
    "id"          SERIAL PRIMARY KEY,
    "userId"      INTEGER NOT NULL REFERENCES "User"("id"),
    "toolName"    TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "callCount"   INTEGER NOT NULL DEFAULT 0,
    "lastCallAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentWriteRateLimit_userId_toolName_windowStart_key"
      UNIQUE ("userId", "toolName", "windowStart")
  )`,
  `CREATE INDEX IF NOT EXISTS "AgentWriteRateLimit_userId_toolName_idx"
    ON "AgentWriteRateLimit"("userId", "toolName")`,

  // ── Bug 6 fix: idempotency constraint on write_confirmation records ────────
  // At most one PENDING write_confirmation may exist per session at a time.
  // Without this constraint, two concurrent POST .../confirm calls can both
  // create PENDING records, risking double-execution of write tools.
  // This is a partial unique index scoped to the specific combination that
  // must be unique: one PENDING write_confirmation per session.
  `CREATE UNIQUE INDEX IF NOT EXISTS "AgentToolCall_pending_write_confirm_unique"
    ON "AgentToolCall" ("sessionId")
    WHERE "status" = 'PENDING' AND "toolName" = 'write_confirmation'`,

  // ── Assignment reminder tracking ──────────────────────────────────────────
  // Added 2026-07-17: tracks whether the 1-hour-before reminder was sent,
  // preventing duplicate notifications from the cron job.
  `ALTER TABLE "Assignment"
    ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3)`,

  // ── DOB verification against HAC (school portal) record ────────────────────
  // Added 2026-07-18. hacDateOfBirth is encrypted at rest the same way as
  // dateOfBirth (AES-256-GCM, CREDENTIAL_ENCRYPTION_KEY). accountStatus is the
  // first real Postgres enum in this schema — CREATE TYPE has no native
  // IF NOT EXISTS, hence the DO-block guard below.
  `DO $$ BEGIN
    CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DOB_MISMATCH_LOCKED', 'UNDER_13_BANNED');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$`,
  `ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "accountStatus"         "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "hacDateOfBirth"         TEXT,
    ADD COLUMN IF NOT EXISTS "bannedUntilDate"        TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "dobCorrectionAttempts"  INTEGER NOT NULL DEFAULT 0`,

  // ── Portal-down detection: consecutive sync failure counters ─────────────────
  // Added 2026-07-18. Tracks how many back-to-back sync cycles have failed for
  // a school portal connection. The frontend derives portalDown from
  // (syncError === 'UNREACHABLE' || syncError === 'NETWORK_ERROR') &&
  // consecutiveSyncFailures >= 2 — a threshold of 2 avoids false-positive alarms
  // from a single transient network blip. Resets to 0 on every successful sync.
  `ALTER TABLE "SchoolConnection"
    ADD COLUMN IF NOT EXISTS "consecutiveSyncFailures" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "CanvasConnection"
    ADD COLUMN IF NOT EXISTS "consecutiveSyncFailures" INTEGER NOT NULL DEFAULT 0`,
]

// Data-level repairs that are always idempotent and safe to re-run on every cold start.
// These fix rows that became inconsistent before code-level guards were in place.
const DATA_REPAIRS: string[] = [
  // Clear stale badge values: user sold their verified tag without un-equipping it.
  `UPDATE "User"
   SET badge = NULL
   WHERE badge IN ('verified-yellow', 'verified-blue')
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(
         CASE
           WHEN jsonb_typeof("allTags") = 'string' THEN ("allTags"#>>'{}')::jsonb
           WHEN jsonb_typeof("allTags") = 'array'  THEN "allTags"
           ELSE '[]'::jsonb
         END
       ) AS t
       WHERE t->>'tagColor' = "User".badge
     )`,

  // Clear stale equipped tagColor / tag values for the same reason.
  `UPDATE "User"
   SET tag = 'Student', "tagColor" = NULL
   WHERE "tagColor" IN ('verified-yellow', 'verified-blue')
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(
         CASE
           WHEN jsonb_typeof("allTags") = 'string' THEN ("allTags"#>>'{}')::jsonb
           WHEN jsonb_typeof("allTags") = 'array'  THEN "allTags"
           ELSE '[]'::jsonb
         END
       ) AS t
       WHERE t->>'tagColor' = "User"."tagColor"
     )`,

  // Fix "dateOfBirth" column type: it was created as a native DATE/TIMESTAMP
  // column by an earlier (pre-encryption) version of this field, before the
  // schema switched it to an encrypted TEXT ciphertext. The ADD COLUMN IF
  // NOT EXISTS patch above is a no-op once a column already exists under any
  // type, so it silently left the wrong type in place — every write of an
  // encrypted ciphertext into this column failed with a Postgres 22007
  // "invalid input syntax for type date" error. This lives in DATA_REPAIRS
  // (not PATCHES) because PATCHES only runs when the schema probe fails on a
  // *missing* column — a wrong-typed-but-present column passes that probe
  // and would otherwise never get corrected. Guarded on current type so this
  // is a cheap metadata check on every cold start once fixed, not a repeated
  // table rewrite.
  `DO $$ BEGIN
     IF (
       SELECT data_type FROM information_schema.columns
       WHERE table_name = 'User' AND column_name = 'dateOfBirth'
     ) <> 'text' THEN
       ALTER TABLE "User" ALTER COLUMN "dateOfBirth" TYPE TEXT USING "dateOfBirth"::TEXT;
     END IF;
   END $$`,

  // ── AI chat sessions (account-synced, replaces localStorage-only history) ──
  `CREATE TABLE IF NOT EXISTS "AiChatSession" (
    "id"        TEXT PRIMARY KEY,
    "userId"    INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "title"     TEXT NOT NULL,
    "messages"  JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "AiChatSession_userId_updatedAt_idx" ON "AiChatSession" ("userId", "updatedAt")`,

  // ── GPA nightly check-in baseline ────────────────────────────────────────
  `ALTER TABLE "Profile"
    ADD COLUMN IF NOT EXISTS "lastGpaCheckinWeighted"   DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "lastGpaCheckinUnweighted" DOUBLE PRECISION`,
]

let patchPromise: Promise<void> | null = null

export function ensureSchema(): Promise<void> {
  if (patchPromise) return patchPromise
  patchPromise = (async () => {
    // Probe checks the newest schema additions. If all exist, schema patches are skipped.
    // IMPORTANT: update this probe whenever a new column/table is added to PATCHES above —
    // a stale probe silently skips every patch added after it, even ones further down the
    // list (this caused a production outage: loginStreak/tosAcceptedAt/privacyAcceptedAt/
    // ageConfirmedAt were in PATCHES but never applied because the probe still only checked
    // spinCoinsSpent + EmailOTP, both already present from an earlier patch run).
    try {
      await prisma.$queryRawUnsafe(`SELECT "spinCoinsSpent" FROM "User" LIMIT 0`)
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "EmailOTP" LIMIT 0`)
      await prisma.$queryRawUnsafe(`SELECT "loginStreak", "tosAcceptedAt", "privacyAcceptedAt", "ageConfirmedAt" FROM "User" LIMIT 0`)
      await prisma.$queryRawUnsafe(`SELECT "startDate", "reminderSentAt" FROM "Assignment" LIMIT 0`)
      // Agentic + reminder schema additions — probe updated 2026-07-17
      await prisma.$queryRawUnsafe(`SELECT "coppaConsentStatus", "autonomousConsentAcceptedAt" FROM "User" LIMIT 0`)
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "AgentSession" LIMIT 0`)
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "AgentToolCall" LIMIT 0`)
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "AgentWriteRateLimit" LIMIT 0`)
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "AutonomousAgentJob" LIMIT 0`)
      // DOB verification against HAC — probe updated 2026-07-18
      await prisma.$queryRawUnsafe(`SELECT "accountStatus", "hacDateOfBirth", "bannedUntilDate", "dobCorrectionAttempts" FROM "User" LIMIT 0`)
      // Portal-down detection: consecutive failure counters — probe updated 2026-07-18
      await prisma.$queryRawUnsafe(`SELECT "consecutiveSyncFailures" FROM "SchoolConnection" LIMIT 0`)
      await prisma.$queryRawUnsafe(`SELECT "consecutiveSyncFailures" FROM "CanvasConnection" LIMIT 0`)
      // Bug 6 fix: probe for the write_confirmation idempotency index — probe updated 2026-07-16
      const idxProbe = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE indexname = 'AgentToolCall_pending_write_confirm_unique'
        ) AS "exists"
      `
      if (!idxProbe[0]?.exists) throw new Error('Missing idempotency index: AgentToolCall_pending_write_confirm_unique')
      // AI chat session sync — probe added 2026-07-19
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "AiChatSession" LIMIT 0`)
      // GPA nightly check-in baseline — probe added 2026-07-19
      await prisma.$queryRawUnsafe(`SELECT "lastGpaCheckinWeighted", "lastGpaCheckinUnweighted" FROM "Profile" LIMIT 0`)
      // Visible on every cold start so a stale/incomplete probe (or a warm instance that
      // never re-checks) shows up in logs instead of failing silently — this is the exact
      // gap that let reminderSentAt stay missing in production undetected.
      console.log('[startup] schema probe passed, patches skipped')
    } catch {
      // Schema is incomplete — run patches below.
      for (const sql of PATCHES) {
        try {
          await prisma.$executeRawUnsafe(sql)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists') && !msg.includes('does not exist')) {
            console.error('[startup] patch failed:', sql.slice(0, 80), msg)
          }
        }
      }
      console.log('[startup] schema patches complete')
    }

    // Always run data repairs — they are idempotent and fast.
    for (const sql of DATA_REPAIRS) {
      try {
        await prisma.$executeRawUnsafe(sql)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[startup] data repair failed:', sql.slice(0, 80), msg)
      }
    }
  })()
  return patchPromise
}
import { safeConsole as console } from '../common/safeConsole'
