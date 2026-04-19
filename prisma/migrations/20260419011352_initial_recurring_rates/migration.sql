-- CreateEnum
CREATE TYPE "RateField" AS ENUM ('LEGACY', 'INITIAL', 'RECURRING');

-- AlterTable
ALTER TABLE "CommissionEvent" ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CommissionRateAudit" ADD COLUMN     "field" "RateField" NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "initialCommissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "recurringCommissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "CommissionEvent_rewardfulReferralId_idx" ON "CommissionEvent"("rewardfulReferralId");

-- Seed dual rates from legacy commissionPercent. Both sides equal the current
-- single rate, so payouts don't change on deploy — admin splits the values
-- explicitly when they're ready (the re-price runs on that next save).
-- Idempotent: only seeds users whose new rate fields are still at their
-- default (0, 0). Re-running this migration won't clobber admin edits.
UPDATE "User" SET
  "initialCommissionPercent"   = "commissionPercent",
  "recurringCommissionPercent" = "commissionPercent"
WHERE "initialCommissionPercent" = 0 AND "recurringCommissionPercent" = 0;

-- Backfill rewardfulReferralId from the stored rewardfulData payload before
-- classification. The historical extraction code read `commission.referral.id`
-- which doesn't exist in Rewardful's payload — the referral lives at
-- `commission.sale.referral.id` (or wrapped under `data.sale.referral.id`
-- for some v1 webhook variants, or `commission.sale.referral.id` under a
-- `commission` wrapper). COALESCE tries each layout in order. New code (in
-- this commit) uses the corrected extraction for go-forward events.
UPDATE "CommissionEvent"
SET "rewardfulReferralId" = COALESCE(
  "rewardfulData"->'sale'->'referral'->>'id',
  "rewardfulData"->'data'->'sale'->'referral'->>'id',
  "rewardfulData"->'commission'->'sale'->'referral'->>'id'
)
WHERE "rewardfulReferralId" IS NULL
  AND COALESCE(
    "rewardfulData"->'sale'->'referral'->>'id',
    "rewardfulData"->'data'->'sale'->'referral'->>'id',
    "rewardfulData"->'commission'->'sale'->'referral'->>'id'
  ) IS NOT NULL;

-- Classify every existing CommissionEvent as initial or recurring. For each
-- Rewardful referral ID present in our DB, the earliest conversionDate wins
-- INITIAL; all other events for that referral are RECURRING. Ties on
-- conversionDate (rare — same-second deliveries) are broken by createdAt,
-- then by id so the classification is stable across re-runs.
-- Events with NULL rewardfulReferralId stay isRecurring=false (default),
-- which equates to "treated as initial" for rate purposes.
-- Assigns isRecurring = (rn > 1) in a single update so the classification
-- is fully idempotent — re-running resets stale flags too, not just the
-- initial false-to-true flip.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "rewardfulReferralId"
      ORDER BY "conversionDate" ASC, "createdAt" ASC, id ASC
    ) AS rn
  FROM "CommissionEvent"
  WHERE "rewardfulReferralId" IS NOT NULL
)
UPDATE "CommissionEvent" e
SET "isRecurring" = (r.rn > 1)
FROM ranked r
WHERE e.id = r.id;
