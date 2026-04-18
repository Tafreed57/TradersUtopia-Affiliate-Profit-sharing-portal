-- CreateEnum
CREATE TYPE "CommissionRole" AS ENUM ('AFFILIATE', 'TEACHER');

-- CreateTable
CREATE TABLE "CommissionEvent" (
    "id" TEXT NOT NULL,
    "rewardfulCommissionId" TEXT,
    "rewardfulReferralId" TEXT,
    "affiliateId" TEXT NOT NULL,
    "conversionDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fullAmountCad" DECIMAL(12,2) NOT NULL,
    "ceoCutCad" DECIMAL(12,2) NOT NULL,
    "rewardfulData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSplit" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "role" "CommissionRole" NOT NULL,
    "depth" INTEGER,
    "cutPercent" DECIMAL(5,2) NOT NULL,
    "cutCad" DECIMAL(12,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "forfeitedToCeo" BOOLEAN NOT NULL DEFAULT false,
    "forfeitureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEvent_rewardfulCommissionId_key" ON "CommissionEvent"("rewardfulCommissionId");

-- CreateIndex
CREATE INDEX "CommissionEvent_affiliateId_idx" ON "CommissionEvent"("affiliateId");

-- CreateIndex
CREATE INDEX "CommissionEvent_conversionDate_idx" ON "CommissionEvent"("conversionDate");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionSplit_idempotencyKey_key" ON "CommissionSplit"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommissionSplit_recipientId_idx" ON "CommissionSplit"("recipientId");

-- CreateIndex
CREATE INDEX "CommissionSplit_status_idx" ON "CommissionSplit"("status");

-- CreateIndex
CREATE INDEX "CommissionSplit_paidAt_idx" ON "CommissionSplit"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionSplit_eventId_recipientId_key" ON "CommissionSplit"("eventId", "recipientId");

-- AddForeignKey
ALTER TABLE "CommissionEvent" ADD CONSTRAINT "CommissionEvent_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CommissionSplit" ADD CONSTRAINT "CommissionSplit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CommissionEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSplit" ADD CONSTRAINT "CommissionSplit_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Data migration: copy legacy Commission rows into CommissionEvent + CommissionSplit.
-- Affiliate rows (teacherId IS NULL) become events + AFFILIATE splits; teacher rows
-- (teacherId IS NOT NULL) join back to their event via rewardfulCommissionId and
-- become TEACHER splits. Depth is pulled from the active TeacherStudent relation
-- at migration time. Legacy Commission rows are left in place (dropped in a
-- separate migration 1 week after stable deploy).

INSERT INTO "CommissionEvent" (id, "rewardfulCommissionId", "rewardfulReferralId", "affiliateId",
                                "conversionDate", currency, "fullAmountCad", "ceoCutCad",
                                "rewardfulData", "createdAt", "updatedAt")
SELECT 'cev_' || c.id, c."rewardfulCommissionId", c."rewardfulReferralId", c."affiliateId",
       c."conversionDate", c.currency, c."fullAmountCad", c."ceoCutCad",
       c."rewardfulData", c."processedAt", c."processedAt"
FROM "Commission" c
WHERE c."teacherId" IS NULL;

INSERT INTO "CommissionSplit" (id, "eventId", "recipientId", role, "cutPercent", "cutCad",
                                status, "forfeitedToCeo", "forfeitureReason", "paidAt", "voidedAt",
                                "idempotencyKey", "createdAt", "updatedAt")
SELECT 'csp_' || c.id, 'cev_' || c.id, c."affiliateId", 'AFFILIATE',
       c."affiliateCutPercent", c."affiliateCutCad", c.status, c."forfeitedToCeo",
       c."forfeitureReason", c."paidAt", c."voidedAt",
       COALESCE(c."idempotencyKey", 'legacy_aff_' || c.id),
       c."processedAt", c."processedAt"
FROM "Commission" c
WHERE c."teacherId" IS NULL;

INSERT INTO "CommissionSplit" (id, "eventId", "recipientId", role, depth, "cutPercent", "cutCad",
                                status, "forfeitedToCeo", "forfeitureReason", "paidAt", "voidedAt",
                                "idempotencyKey", "createdAt", "updatedAt")
SELECT 'csp_' || t.id, e.id, t."teacherId", 'TEACHER',
       (SELECT ts.depth FROM "TeacherStudent" ts
        WHERE ts."teacherId" = t."teacherId" AND ts."studentId" = t."affiliateId"
          AND ts.status = 'ACTIVE' LIMIT 1),
       t."teacherCutPercent", t."teacherCutCad", t.status, t."forfeitedToCeo",
       t."forfeitureReason", t."paidAt", t."voidedAt",
       COALESCE(t."idempotencyKey", 'legacy_tch_' || t.id),
       t."processedAt", t."processedAt"
FROM "Commission" t
JOIN "CommissionEvent" e ON e."rewardfulCommissionId" = t."rewardfulCommissionId"
WHERE t."teacherId" IS NOT NULL;
