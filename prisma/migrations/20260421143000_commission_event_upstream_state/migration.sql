ALTER TABLE "CommissionEvent"
ADD COLUMN "upstreamState" TEXT,
ADD COLUMN "upstreamDueAt" TIMESTAMP(3),
ADD COLUMN "upstreamPaidAt" TIMESTAMP(3),
ADD COLUMN "upstreamVoidedAt" TIMESTAMP(3),
ADD COLUMN "campaignId" TEXT,
ADD COLUMN "campaignName" TEXT;

CREATE INDEX "CommissionEvent_upstreamState_idx" ON "CommissionEvent"("upstreamState");
CREATE INDEX "CommissionEvent_upstreamDueAt_idx" ON "CommissionEvent"("upstreamDueAt");
CREATE INDEX "CommissionEvent_campaignId_idx" ON "CommissionEvent"("campaignId");
