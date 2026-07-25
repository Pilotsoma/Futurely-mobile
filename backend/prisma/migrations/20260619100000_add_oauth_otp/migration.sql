-- Make passwordHash nullable for OAuth users
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- OAuth accounts table
CREATE TABLE IF NOT EXISTS "OAuthAccount" (
  "id"         SERIAL PRIMARY KEY,
  "userId"     INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "provider"   TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "email"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAccount_provider_providerId_key" UNIQUE ("provider", "providerId")
);

-- Email OTP table
CREATE TABLE IF NOT EXISTS "EmailOTP" (
  "id"        SERIAL PRIMARY KEY,
  "email"     TEXT NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
