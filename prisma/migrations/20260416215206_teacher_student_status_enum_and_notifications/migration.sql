/*
  Warnings:

  - You are about to drop the column `isActive` on the `TeacherStudent` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TeacherStudentStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'DEACTIVATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'STUDENT_PROPOSAL_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'STUDENT_PROPOSAL_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'STUDENT_PROPOSAL_REJECTED';

-- DropIndex
DROP INDEX "TeacherStudent_teacherId_isActive_idx";

-- AlterTable
ALTER TABLE "TeacherStudent" DROP COLUMN "isActive",
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "TeacherStudentStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "TeacherStudent_teacherId_status_idx" ON "TeacherStudent"("teacherId", "status");

-- CreateIndex
CREATE INDEX "TeacherStudent_status_idx" ON "TeacherStudent"("status");
