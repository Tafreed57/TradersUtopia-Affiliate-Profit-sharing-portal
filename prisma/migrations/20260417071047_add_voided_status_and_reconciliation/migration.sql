-- AlterEnum
ALTER TYPE "CommissionStatus" ADD VALUE 'VOIDED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'COMMISSION_VOIDED';

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "voidedAt" TIMESTAMP(3);
