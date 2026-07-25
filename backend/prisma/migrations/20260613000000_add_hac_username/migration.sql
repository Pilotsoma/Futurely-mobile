-- AlterTable
ALTER TABLE "SchoolConnection" ADD COLUMN "hacUsername" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SchoolConnection_systemType_districtUrl_hacUsername_key" ON "SchoolConnection"("systemType", "districtUrl", "hacUsername");