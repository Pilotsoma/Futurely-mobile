-- Add hacName column to store the real name fetched from HAC
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hacName" TEXT;

-- Copy existing name values into hacName so current users keep their real name visible
UPDATE "User" SET "hacName" = "name" WHERE "hacName" IS NULL AND "name" IS NOT NULL;

-- Clear duplicate names that would block the unique index (keep only the first occurrence)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY id) AS rn
  FROM "User"
  WHERE name IS NOT NULL
)
UPDATE "User" SET name = NULL
FROM ranked
WHERE "User".id = ranked.id AND ranked.rn > 1;

-- Now add the unique constraint (NULLs are never considered duplicates in PostgreSQL)
ALTER TABLE "User" ADD CONSTRAINT IF NOT EXISTS "User_name_key" UNIQUE ("name");
