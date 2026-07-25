-- CreateTable
CREATE TABLE "CollegeInsightsCache" (
    "id" SERIAL NOT NULL,
    "collegeListItemId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "inputHash" CHAR(64) NOT NULL,
    "narrativeSummary" TEXT NOT NULL,
    "actionableSteps" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollegeInsightsCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollegeInsightsCache_collegeListItemId_key" ON "CollegeInsightsCache"("collegeListItemId");

-- CreateIndex
CREATE INDEX "CollegeInsightsCache_userId_idx" ON "CollegeInsightsCache"("userId");

-- AddForeignKey
ALTER TABLE "CollegeInsightsCache" ADD CONSTRAINT "CollegeInsightsCache_collegeListItemId_fkey" FOREIGN KEY ("collegeListItemId") REFERENCES "CollegeListItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
