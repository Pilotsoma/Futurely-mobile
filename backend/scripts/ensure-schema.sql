-- Idempotent schema patches — safe to run on every deployment.
-- All ADD COLUMN / CREATE TABLE use IF NOT EXISTS so re-runs are no-ops.

-- ── User table patches ───────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hacName" TEXT;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastCoinClaim" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nameColor" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pfpEffect" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ownedNameColors" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ownedPfpEffects" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "allTags" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "chatBanned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "chatMutedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerificationToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerificationExpiry" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Deduplicate name values before adding unique constraint.
-- Keeps the first occurrence (lowest id) and nulls out any later duplicates.
-- This is safe to re-run: if no duplicates exist it's a no-op.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY id) AS rn
  FROM "User"
  WHERE name IS NOT NULL
)
UPDATE "User" SET name = NULL
FROM ranked
WHERE "User".id = ranked.id AND ranked.rn > 1;

-- Unique constraint on name (NULLs are never considered duplicates in PostgreSQL)
ALTER TABLE "User" ADD CONSTRAINT IF NOT EXISTS "User_name_key" UNIQUE ("name");

-- ── Post table patches ───────────────────────────────────────────────────────
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "giveawayTag" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "giveawayTagColor" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "giveawayCoinAmount" INTEGER;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "giveawayEndsAt" TIMESTAMP(3);
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "giveawayWinnerId" INTEGER;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "giveawayItemType" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "giveawayItemId" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "giveawayItemRarity" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "unboxItemType" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "unboxItemId" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "unboxItemName" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "unboxItemValue" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "unboxItemRarity" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "unboxItemEstValue" INTEGER;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "unboxItemTagColor" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "pinnedUntil" TIMESTAMP(3);

-- ── GiveawayEntry table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GiveawayEntry" (
  "id"        SERIAL PRIMARY KEY,
  "postId"    INTEGER NOT NULL REFERENCES "Post"("id") ON DELETE CASCADE,
  "userId"    INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiveawayEntry_postId_userId_key" UNIQUE ("postId", "userId")
);

-- ── CommentLike table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommentLike" (
  "id"        SERIAL PRIMARY KEY,
  "commentId" INTEGER NOT NULL REFERENCES "Comment"("id") ON DELETE CASCADE,
  "userId"    INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommentLike_commentId_userId_key" UNIQUE ("commentId", "userId")
);

-- ── OAuth / OTP tables ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OAuthAccount" (
  "id"         SERIAL PRIMARY KEY,
  "userId"     INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "provider"   TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "email"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAccount_provider_providerId_key" UNIQUE ("provider", "providerId")
);

CREATE TABLE IF NOT EXISTS "EmailOTP" (
  "id"        SERIAL PRIMARY KEY,
  "email"     TEXT NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
