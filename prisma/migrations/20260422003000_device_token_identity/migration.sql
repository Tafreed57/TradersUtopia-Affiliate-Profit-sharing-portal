-- Add stable device identity metadata so a single browser install can
-- replace old rotated push tokens instead of accumulating duplicates.
ALTER TABLE "DeviceToken"
ADD COLUMN "deviceId" TEXT,
ADD COLUMN "userAgent" TEXT;

CREATE UNIQUE INDEX "DeviceToken_userId_deviceId_key"
ON "DeviceToken"("userId", "deviceId");
