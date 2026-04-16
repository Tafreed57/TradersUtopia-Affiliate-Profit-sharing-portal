-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PromoCodeRequestStatus" AS ENUM ('PENDING_TEACHER', 'APPROVED_TEACHER', 'REJECTED_TEACHER', 'CREATED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('EARNED', 'FORFEITED', 'PENDING');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CONVERSION_RECEIVED', 'ATTENDANCE_FORFEITURE_ALERT', 'PROMO_CODE_REQUEST_RECEIVED', 'PROMO_CODE_APPROVED', 'PROMO_CODE_REJECTED', 'COMMISSION_RATE_CHANGED', 'NEW_STUDENT_LINKED', 'AFFILIATE_DEACTIVATED', 'AFFILIATE_AUTO_CREATED', 'RATE_PROPOSAL_SUBMITTED', 'RATE_PROPOSAL_APPROVED', 'RATE_PROPOSAL_REJECTED');

-- CreateEnum
CREATE TYPE "RewardfulBackfillStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "canProposeRates" BOOLEAN NOT NULL DEFAULT true,
    "rewardfulAffiliateId" TEXT,
    "rewardfulEmail" TEXT,
    "backfillStatus" "RewardfulBackfillStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "backfillStartedAt" TIMESTAMP(3),
    "backfillCompletedAt" TIMESTAMP(3),
    "backfillError" TEXT,
    "lifetimeStatsCachedAt" TIMESTAMP(3),
    "lifetimeStatsJson" JSONB,
    "preferredCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherStudent" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 1,
    "teacherCut" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "affiliateId" TEXT NOT NULL,
    "teacherId" TEXT,
    "rewardfulCommissionId" TEXT,
    "rewardfulReferralId" TEXT,
    "idempotencyKey" TEXT,
    "fullAmountCad" DECIMAL(10,2) NOT NULL,
    "affiliateCutPercent" DECIMAL(5,2) NOT NULL,
    "affiliateCutCad" DECIMAL(10,2) NOT NULL,
    "teacherCutPercent" DECIMAL(5,2),
    "teacherCutCad" DECIMAL(10,2),
    "ceoCutCad" DECIMAL(10,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "forfeitedToCeo" BOOLEAN NOT NULL DEFAULT false,
    "forfeitureReason" TEXT,
    "conversionDate" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardfulData" JSONB,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRateAudit" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "affiliateId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "previousPercent" DECIMAL(5,2) NOT NULL,
    "newPercent" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRateAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateProposal" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "proposerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "proposedPercent" DECIMAL(5,2) NOT NULL,
    "currentPercent" DECIMAL(5,2) NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "RateProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "note" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCodeRequest" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "requesterId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "proposedCode" TEXT NOT NULL,
    "status" "PromoCodeRequestStatus" NOT NULL DEFAULT 'PENDING_TEACHER',
    "rewardfulCouponId" TEXT,
    "rejectionReason" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "PromoCodeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "sentPush" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRateCache" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(10,6) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRateCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_rewardfulAffiliateId_key" ON "User"("rewardfulAffiliateId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_rewardfulAffiliateId_idx" ON "User"("rewardfulAffiliateId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "TeacherStudent_teacherId_idx" ON "TeacherStudent"("teacherId");

-- CreateIndex
CREATE INDEX "TeacherStudent_studentId_idx" ON "TeacherStudent"("studentId");

-- CreateIndex
CREATE INDEX "TeacherStudent_teacherId_isActive_idx" ON "TeacherStudent"("teacherId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherStudent_teacherId_studentId_key" ON "TeacherStudent"("teacherId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_idempotencyKey_key" ON "Commission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Commission_affiliateId_idx" ON "Commission"("affiliateId");

-- CreateIndex
CREATE INDEX "Commission_teacherId_idx" ON "Commission"("teacherId");

-- CreateIndex
CREATE INDEX "Commission_conversionDate_idx" ON "Commission"("conversionDate");

-- CreateIndex
CREATE INDEX "Commission_status_idx" ON "Commission"("status");

-- CreateIndex
CREATE INDEX "Commission_rewardfulCommissionId_idx" ON "Commission"("rewardfulCommissionId");

-- CreateIndex
CREATE INDEX "CommissionRateAudit_affiliateId_idx" ON "CommissionRateAudit"("affiliateId");

-- CreateIndex
CREATE INDEX "CommissionRateAudit_createdAt_idx" ON "CommissionRateAudit"("createdAt");

-- CreateIndex
CREATE INDEX "RateProposal_status_idx" ON "RateProposal"("status");

-- CreateIndex
CREATE INDEX "RateProposal_proposerId_idx" ON "RateProposal"("proposerId");

-- CreateIndex
CREATE INDEX "RateProposal_studentId_idx" ON "RateProposal"("studentId");

-- CreateIndex
CREATE INDEX "Attendance_userId_date_idx" ON "Attendance"("userId", "date");

-- CreateIndex
CREATE INDEX "Attendance_userId_idx" ON "Attendance"("userId");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE INDEX "PromoCodeRequest_requesterId_idx" ON "PromoCodeRequest"("requesterId");

-- CreateIndex
CREATE INDEX "PromoCodeRequest_reviewerId_idx" ON "PromoCodeRequest"("reviewerId");

-- CreateIndex
CREATE INDEX "PromoCodeRequest_status_idx" ON "PromoCodeRequest"("status");

-- CreateIndex
CREATE INDEX "PromoCodeRequest_proposedCode_idx" ON "PromoCodeRequest"("proposedCode");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE INDEX "ExchangeRateCache_fetchedAt_idx" ON "ExchangeRateCache"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRateCache_fromCurrency_toCurrency_key" ON "ExchangeRateCache"("fromCurrency", "toCurrency");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudent" ADD CONSTRAINT "TeacherStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TeacherStudent" ADD CONSTRAINT "TeacherStudent_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CommissionRateAudit" ADD CONSTRAINT "CommissionRateAudit_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CommissionRateAudit" ADD CONSTRAINT "CommissionRateAudit_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RateProposal" ADD CONSTRAINT "RateProposal_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RateProposal" ADD CONSTRAINT "RateProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RateProposal" ADD CONSTRAINT "RateProposal_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PromoCodeRequest" ADD CONSTRAINT "PromoCodeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PromoCodeRequest" ADD CONSTRAINT "PromoCodeRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

