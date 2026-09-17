ALTER TYPE "PromoCodeRequestStatus" ADD VALUE IF NOT EXISTS 'CREATING';

CREATE TABLE "PromoCodeReservation" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromoCodeReservation_requestId_fkey" FOREIGN KEY ("requestId")
    REFERENCES "PromoCodeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PromoCodeReservation_requestId_key" ON "PromoCodeReservation"("requestId");
-- Server-side Prisma owns this internal coordination table. Expose no client
-- policies through the public-schema REST interface.
ALTER TABLE "PromoCodeReservation" ENABLE ROW LEVEL SECURITY;

-- Preserve every historical request. Reserve only unambiguous existing codes;
-- the application blocks ambiguous codes until an admin resolves their rows.
INSERT INTO "PromoCodeReservation" ("code", "requestId")
SELECT UPPER("proposedCode"), MIN("id")
FROM "PromoCodeRequest"
WHERE "status"::text IN ('PENDING_TEACHER', 'APPROVED_TEACHER', 'CREATED', 'FAILED')
GROUP BY UPPER("proposedCode") HAVING COUNT(*) = 1;

DO $$
DECLARE duplicate_codes INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_codes FROM (
    SELECT UPPER("proposedCode") FROM "PromoCodeRequest"
    WHERE "status"::text IN ('PENDING_TEACHER', 'APPROVED_TEACHER', 'CREATED', 'FAILED')
    GROUP BY UPPER("proposedCode") HAVING COUNT(*) > 1
  ) duplicates;
  IF duplicate_codes > 0 THEN
    RAISE WARNING '% existing promo codes have multiple active requests; preserved for admin review', duplicate_codes;
  END IF;
END $$;
