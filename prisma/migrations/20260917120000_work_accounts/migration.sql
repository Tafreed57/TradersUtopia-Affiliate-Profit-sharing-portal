-- Additive classification: all existing accounts retain their current program.
CREATE TYPE "PortalAccountType" AS ENUM ('COMMISSION', 'WORK');
ALTER TABLE "User" ADD COLUMN "accountType" "PortalAccountType" NOT NULL DEFAULT 'COMMISSION';
CREATE INDEX "User_accountType_idx" ON "User"("accountType");
