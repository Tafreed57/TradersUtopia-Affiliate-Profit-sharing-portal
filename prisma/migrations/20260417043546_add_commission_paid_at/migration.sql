-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Commission_paidAt_idx" ON "Commission"("paidAt");
