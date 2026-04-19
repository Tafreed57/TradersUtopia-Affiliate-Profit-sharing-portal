-- Adds the onboarding-lock flag + rate-change audit mode tracking.

-- User.ratesLocked — false by default (onboarding mode, retroactive recalc).
-- Admin flips to true to lock history; rate changes then only affect
-- future webhook-delivered commissions.
ALTER TABLE "User" ADD COLUMN "ratesLocked" BOOLEAN NOT NULL DEFAULT false;

-- CommissionRateAudit.appliedMode — records whether a rate change was
-- retroactive (re-priced unpaid) or forward-only, plus LOCK/UNLOCK events.
CREATE TYPE "RateChangeMode" AS ENUM ('RETROACTIVE', 'FORWARD_ONLY', 'LOCK', 'UNLOCK');

ALTER TABLE "CommissionRateAudit"
  ADD COLUMN "appliedMode" "RateChangeMode" NOT NULL DEFAULT 'RETROACTIVE';

-- Extend RateField enum with LOCK so lock/unlock audit rows have a
-- coherent field value (avoids stuffing them into LEGACY).
ALTER TYPE "RateField" ADD VALUE IF NOT EXISTS 'LOCK';
