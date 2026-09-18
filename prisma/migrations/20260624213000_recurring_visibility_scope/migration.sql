ALTER TABLE "User"
ADD COLUMN "recurringCommissionsVisibleFrom" TIMESTAMP(3);

ALTER TABLE "User"
ALTER COLUMN "canSeeRecurringCommissions" SET DEFAULT false;
