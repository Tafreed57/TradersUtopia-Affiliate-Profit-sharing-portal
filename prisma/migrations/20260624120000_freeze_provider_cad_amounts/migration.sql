ALTER TABLE "CommissionEvent"
ADD COLUMN "providerFullAmountCad" DECIMAL(12,2);

ALTER TABLE "CommissionSplit"
ADD COLUMN "providerCutCad" DECIMAL(12,2);
