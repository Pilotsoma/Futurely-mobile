-- AlterTable: add nullable consent timestamp columns to User
ALTER TABLE "User" ADD COLUMN "tosAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "privacyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "ageConfirmedAt" TIMESTAMP(3);

-- Backfill: grandfather all existing users by setting their consent timestamps
-- to their account creation time so no live user is locked out by the new guard.
-- New users created after this migration will have NULL until they accept consent.
UPDATE "User"
SET
  "tosAcceptedAt"    = "createdAt",
  "privacyAcceptedAt" = "createdAt",
  "ageConfirmedAt"   = "createdAt"
WHERE
  "tosAcceptedAt" IS NULL
  OR "privacyAcceptedAt" IS NULL
  OR "ageConfirmedAt" IS NULL;
