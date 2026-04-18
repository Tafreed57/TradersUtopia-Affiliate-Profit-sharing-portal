-- CreateEnum
CREATE TYPE "RelationshipOrigin" AS ENUM ('SELF_PROPOSAL', 'ADMIN_PAIR');

-- AlterTable
ALTER TABLE "TeacherStudent" ADD COLUMN     "createdVia" "RelationshipOrigin" NOT NULL DEFAULT 'SELF_PROPOSAL';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canBeTeacher" BOOLEAN NOT NULL DEFAULT false;

-- Grandfather existing teachers: any user who has at least one ACTIVE
-- TeacherStudent row where they are the teacher gets canBeTeacher=true.
-- Existing relationships stay ACTIVE; only the self-proposal capability
-- flag is being backfilled so current teachers don't lose the ability to
-- add more students.
UPDATE "User" u
SET "canBeTeacher" = true
WHERE EXISTS (
  SELECT 1 FROM "TeacherStudent" ts
  WHERE ts."teacherId" = u.id AND ts.status = 'ACTIVE'
);
