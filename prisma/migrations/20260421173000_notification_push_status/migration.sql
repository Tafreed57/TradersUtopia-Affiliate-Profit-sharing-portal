CREATE TYPE "PushStatus" AS ENUM (
  'PENDING',
  'SENT',
  'FAILED',
  'SKIPPED_NO_TOKEN',
  'SKIPPED_NO_MESSAGING',
  'SKIPPED_PREF'
);

ALTER TABLE "Notification"
ADD COLUMN "pushStatus" "PushStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "pushError" TEXT;

UPDATE "Notification"
SET "pushStatus" = CASE
  WHEN "sentPush" = true THEN 'SENT'::"PushStatus"
  ELSE 'PENDING'::"PushStatus"
END;

CREATE INDEX "Notification_pushStatus_idx" ON "Notification"("pushStatus");
