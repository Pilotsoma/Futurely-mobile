-- Create CollegeScorecardCache table as a shared lookup/cache for Scorecard API data
CREATE TABLE "CollegeScorecardCache" (
    "id"            SERIAL PRIMARY KEY,
    "unitId"        TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "city"          TEXT,
    "state"         TEXT,
    "admissionRate" DOUBLE PRECISION,
    "sat25th"       INTEGER,
    "sat75th"       INTEGER,
    "enrollment"    INTEGER,
    "fetchedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint on unitId (natural key from College Scorecard)
CREATE UNIQUE INDEX "CollegeScorecardCache_unitId_key" ON "CollegeScorecardCache"("unitId");

-- Index on name to support fuzzy/prefix lookups from the backend service
CREATE INDEX "CollegeScorecardCache_name_idx" ON "CollegeScorecardCache"("name");

-- Add scorecardUnitId to CollegeListItem (nullable for backward compat with existing rows)
ALTER TABLE "CollegeListItem" ADD COLUMN "scorecardUnitId" TEXT;

-- Foreign key from CollegeListItem.scorecardUnitId → CollegeScorecardCache.unitId
ALTER TABLE "CollegeListItem"
    ADD CONSTRAINT "CollegeListItem_scorecardUnitId_fkey"
    FOREIGN KEY ("scorecardUnitId")
    REFERENCES "CollegeScorecardCache"("unitId")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
