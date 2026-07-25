-- Add marketplaceAccess flag to allow DEVs to grant marketplace access without requiring a 3-day login streak
ALTER TABLE "User" ADD COLUMN "marketplaceAccess" BOOLEAN NOT NULL DEFAULT false;
