ALTER TABLE "User"
ADD COLUMN "ratesConfiguredAt" TIMESTAMP(3);

UPDATE "User" u
SET "ratesConfiguredAt" = COALESCE(
  u."backfillCompletedAt",
  u."backfillStartedAt",
  u."updatedAt",
  u."createdAt"
)
WHERE u."ratesConfiguredAt" IS NULL
  AND (
    u."initialCommissionPercent" <> 0
    OR u."recurringCommissionPercent" <> 0
    OR u."backfillStatus" <> 'NOT_STARTED'
    OR u."ratesLocked" = true
    OR EXISTS (
      SELECT 1
      FROM "CommissionRateAudit" a
      WHERE a."affiliateId" = u.id
        AND a.field IN ('LEGACY', 'INITIAL', 'RECURRING')
    )
  );
