-- CreateEnum
CREATE TYPE "TeacherStudentArchiveActorRole" AS ENUM ('ADMIN', 'TEACHER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TeacherStudentRestoreStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TeacherStudentBackfillMode" AS ENUM ('NONE', 'ALL', 'CUSTOM');

-- AlterTable
ALTER TABLE "CommissionSplit"
ADD COLUMN "teacherStudentId" TEXT,
ADD COLUMN "teacherStudentSequence" INTEGER;

-- AlterTable
ALTER TABLE "TeacherStudent"
ADD COLUMN "activationSequence" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "deactivatedAt" TIMESTAMP(3);

UPDATE "TeacherStudent"
SET "activatedAt" = COALESCE("reviewedAt", "createdAt", CURRENT_TIMESTAMP);

UPDATE "TeacherStudent"
SET "deactivatedAt" = COALESCE("reviewedAt", "updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "status" = 'DEACTIVATED'
  AND "deactivatedAt" IS NULL;

-- CreateTable
CREATE TABLE "TeacherStudentArchive" (
    "id" TEXT NOT NULL,
    "teacherStudentId" TEXT NOT NULL,
    "activationSequence" INTEGER NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 1,
    "teacherCut" DECIMAL(5,2) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedById" TEXT,
    "archivedByRole" "TeacherStudentArchiveActorRole" NOT NULL DEFAULT 'ADMIN',
    "archiveReason" TEXT,
    "showInPreviousStudents" BOOLEAN NOT NULL DEFAULT true,
    "snapshotUnpaidCad" DECIMAL(12,2) NOT NULL,
    "snapshotDueCad" DECIMAL(12,2) NOT NULL,
    "snapshotPendingCad" DECIMAL(12,2) NOT NULL,
    "snapshotPaidCad" DECIMAL(12,2) NOT NULL,
    "snapshotCommissionCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotNextDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherStudentArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherStudentRestoreRequest" (
    "id" TEXT NOT NULL,
    "teacherStudentId" TEXT NOT NULL,
    "archiveId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "TeacherStudentRestoreStatus" NOT NULL DEFAULT 'PENDING',
    "requestNote" TEXT,
    "reviewNote" TEXT,
    "backfillMode" "TeacherStudentBackfillMode",
    "grantedEventIds" JSONB,
    "grantedCount" INTEGER NOT NULL DEFAULT 0,
    "grantedAmountCad" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherStudentRestoreRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeacherStudentArchive_teacherStudentId_activationSequence_key" ON "TeacherStudentArchive"("teacherStudentId", "activationSequence");

-- CreateIndex
CREATE INDEX "TeacherStudentArchive_teacherId_showInPreviousStudents_idx" ON "TeacherStudentArchive"("teacherId", "showInPreviousStudents");

-- CreateIndex
CREATE INDEX "TeacherStudentArchive_studentId_idx" ON "TeacherStudentArchive"("studentId");

-- CreateIndex
CREATE INDEX "TeacherStudentArchive_archivedAt_idx" ON "TeacherStudentArchive"("archivedAt");

-- CreateIndex
CREATE INDEX "TeacherStudentRestoreRequest_status_idx" ON "TeacherStudentRestoreRequest"("status");

-- CreateIndex
CREATE INDEX "TeacherStudentRestoreRequest_teacherStudentId_status_idx" ON "TeacherStudentRestoreRequest"("teacherStudentId", "status");

-- CreateIndex
CREATE INDEX "TeacherStudentRestoreRequest_archiveId_status_idx" ON "TeacherStudentRestoreRequest"("archiveId", "status");

-- CreateIndex
CREATE INDEX "CommissionSplit_teacherStudentId_teacherStudentSequence_idx" ON "CommissionSplit"("teacherStudentId", "teacherStudentSequence");

-- AddForeignKey
ALTER TABLE "CommissionSplit"
ADD CONSTRAINT "CommissionSplit_teacherStudentId_fkey"
FOREIGN KEY ("teacherStudentId") REFERENCES "TeacherStudent"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudentArchive"
ADD CONSTRAINT "TeacherStudentArchive_teacherStudentId_fkey"
FOREIGN KEY ("teacherStudentId") REFERENCES "TeacherStudent"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudentArchive"
ADD CONSTRAINT "TeacherStudentArchive_teacherId_fkey"
FOREIGN KEY ("teacherId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudentArchive"
ADD CONSTRAINT "TeacherStudentArchive_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudentArchive"
ADD CONSTRAINT "TeacherStudentArchive_archivedById_fkey"
FOREIGN KEY ("archivedById") REFERENCES "User"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudentRestoreRequest"
ADD CONSTRAINT "TeacherStudentRestoreRequest_teacherStudentId_fkey"
FOREIGN KEY ("teacherStudentId") REFERENCES "TeacherStudent"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudentRestoreRequest"
ADD CONSTRAINT "TeacherStudentRestoreRequest_archiveId_fkey"
FOREIGN KEY ("archiveId") REFERENCES "TeacherStudentArchive"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudentRestoreRequest"
ADD CONSTRAINT "TeacherStudentRestoreRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudentRestoreRequest"
ADD CONSTRAINT "TeacherStudentRestoreRequest_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

UPDATE "CommissionSplit" AS cs
SET "teacherStudentId" = ts.id,
    "teacherStudentSequence" = ts."activationSequence"
FROM "CommissionEvent" AS ce,
     "TeacherStudent" AS ts
WHERE cs."eventId" = ce.id
  AND cs."role" = 'TEACHER'
  AND ts."teacherId" = cs."recipientId"
  AND ts."studentId" = ce."affiliateId"
  AND cs."teacherStudentId" IS NULL;
