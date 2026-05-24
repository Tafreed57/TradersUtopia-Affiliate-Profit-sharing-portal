-- CreateEnum
CREATE TYPE "TeacherStudentArchiveMode" AS ENUM ('SAFE_ARCHIVE', 'COMPLETE_REMOVE');

-- AlterTable
ALTER TABLE "TeacherStudentArchive"
ADD COLUMN "archiveMode" "TeacherStudentArchiveMode" NOT NULL DEFAULT 'SAFE_ARCHIVE';

-- CreateTable
CREATE TABLE "LeaderboardAffiliateVisibility" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "affiliateEmail" TEXT,
    "displayName" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardAffiliateVisibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPerformanceCache" (
    "id" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPerformanceCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardAffiliateVisibility_affiliateId_key" ON "LeaderboardAffiliateVisibility"("affiliateId");

-- CreateIndex
CREATE INDEX "LeaderboardAffiliateVisibility_visible_idx" ON "LeaderboardAffiliateVisibility"("visible");

-- CreateIndex
CREATE INDEX "LeaderboardAffiliateVisibility_affiliateEmail_idx" ON "LeaderboardAffiliateVisibility"("affiliateEmail");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPerformanceCache_range_key" ON "CompanyPerformanceCache"("range");

-- CreateIndex
CREATE INDEX "CompanyPerformanceCache_fetchedAt_idx" ON "CompanyPerformanceCache"("fetchedAt");

