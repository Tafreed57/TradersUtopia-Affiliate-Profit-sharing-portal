/**
 * Commission Calculation Engine
 *
 * Processes Rewardful webhook conversions into commission splits.
 * Handles: idempotency, teacher chain resolution, attendance-based forfeiture,
 * multi-teacher allocation, and CEO remainder calculation.
 */

import { CommissionStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";

import { TEACHER_CUT_WARN_THRESHOLD } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookConversion {
  rewardfulCommissionId: string;
  rewardfulReferralId?: string;
  affiliateRewardfulId: string;
  amountCad: number;
  conversionDate: string; // ISO 8601
  rawPayload: Record<string, unknown>;
}

interface TeacherCutInfo {
  teacherId: string;
  teacherCutPercent: Decimal;
  depth: number;
}

interface CommissionSplit {
  affiliateId: string;
  teacherId: string | null;
  fullAmountCad: Decimal;
  affiliateCutPercent: Decimal;
  affiliateCutCad: Decimal;
  teacherCutPercent: Decimal | null;
  teacherCutCad: Decimal | null;
  ceoCutCad: Decimal;
  status: CommissionStatus;
  forfeitedToCeo: boolean;
  forfeitureReason: string | null;
}

export interface ProcessingResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  commissionsCreated?: number;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Process a single conversion from a Rewardful webhook.
 */
export async function processConversion(
  conversion: WebhookConversion
): Promise<ProcessingResult> {
  const warnings: string[] = [];

  // 1. Idempotency — skip if already processed
  const existing = await prisma.commission.findFirst({
    where: { rewardfulCommissionId: conversion.rewardfulCommissionId },
  });
  if (existing) {
    return { success: true, skipped: true, reason: "Duplicate webhook" };
  }

  // 2. Find affiliate by Rewardful ID
  const affiliate = await prisma.user.findFirst({
    where: {
      rewardfulAffiliateId: conversion.affiliateRewardfulId,
      status: "ACTIVE",
    },
  });
  if (!affiliate) {
    return {
      success: false,
      reason: `No active affiliate found for Rewardful ID ${conversion.affiliateRewardfulId}`,
    };
  }

  const fullAmount = new Decimal(conversion.amountCad);
  const conversionDate = new Date(conversion.conversionDate);

  // 3. Get teacher chain (active teachers at depth 1 and 2)
  const teacherChain = await getTeacherChain(affiliate.id);

  // 4. Calculate splits
  const affiliatePercent = new Decimal(affiliate.commissionPercent.toString());
  const affiliateCut = fullAmount.mul(affiliatePercent).div(100);

  const teacherCuts = teacherChain.map((t) => ({
    ...t,
    amount: fullAmount.mul(t.teacherCutPercent).div(100),
  }));

  const totalTeacherCuts = teacherCuts.reduce(
    (sum, t) => sum.add(t.amount),
    new Decimal(0)
  );

  const totalAllocatedPercent = affiliatePercent.add(
    teacherChain.reduce(
      (sum, t) => sum.add(t.teacherCutPercent),
      new Decimal(0)
    )
  );

  // Warn if total allocation exceeds threshold
  if (totalAllocatedPercent.gt(TEACHER_CUT_WARN_THRESHOLD)) {
    warnings.push(
      `Total allocation for ${affiliate.email} is ${totalAllocatedPercent}% (threshold: ${TEACHER_CUT_WARN_THRESHOLD}%)`
    );
  }

  // CEO gets the remainder (can be negative — signals admin needs to fix)
  const ceoCut = fullAmount.sub(affiliateCut).sub(totalTeacherCuts);

  // 5. Check attendance for forfeiture
  const hasAttendance = await checkAttendance(affiliate.id, conversionDate);

  let finalStatus: CommissionStatus;
  let forfeitedToCeo = false;
  let forfeitureReason: string | null = null;
  let finalAffiliateCut: Decimal;
  let finalCeoCut: Decimal;

  if (!hasAttendance) {
    // Forfeit affiliate cut → goes to CEO. Teachers still get theirs.
    finalStatus = "FORFEITED";
    forfeitedToCeo = true;
    forfeitureReason = "No attendance submitted for conversion date";
    finalAffiliateCut = new Decimal(0);
    finalCeoCut = ceoCut.add(affiliateCut);
  } else {
    finalStatus = "EARNED";
    finalAffiliateCut = affiliateCut;
    finalCeoCut = ceoCut;
  }

  // 6. Store everything in a transaction
  const commissionRecords: Prisma.CommissionCreateManyInput[] = [];

  // Affiliate's own commission record
  commissionRecords.push({
    affiliateId: affiliate.id,
    teacherId: null,
    rewardfulCommissionId: conversion.rewardfulCommissionId,
    rewardfulReferralId: conversion.rewardfulReferralId ?? null,
    fullAmountCad: fullAmount.toDecimalPlaces(2).toNumber(),
    affiliateCutPercent: affiliatePercent.toDecimalPlaces(2).toNumber(),
    affiliateCutCad: finalAffiliateCut.toDecimalPlaces(2).toNumber(),
    teacherCutPercent: null,
    teacherCutCad: null,
    ceoCutCad: finalCeoCut.toDecimalPlaces(2).toNumber(),
    status: finalStatus,
    forfeitedToCeo,
    forfeitureReason,
    conversionDate,
    rewardfulData: conversion.rawPayload as Prisma.InputJsonValue,
  });

  // Teacher commission records (one per teacher in chain)
  for (const tc of teacherCuts) {
    commissionRecords.push({
      affiliateId: affiliate.id,
      teacherId: tc.teacherId,
      rewardfulCommissionId: conversion.rewardfulCommissionId,
      rewardfulReferralId: conversion.rewardfulReferralId ?? null,
      fullAmountCad: fullAmount.toDecimalPlaces(2).toNumber(),
      affiliateCutPercent: affiliatePercent.toDecimalPlaces(2).toNumber(),
      affiliateCutCad: finalAffiliateCut.toDecimalPlaces(2).toNumber(),
      teacherCutPercent: tc.teacherCutPercent.toDecimalPlaces(2).toNumber(),
      teacherCutCad: tc.amount.toDecimalPlaces(2).toNumber(),
      ceoCutCad: finalCeoCut.toDecimalPlaces(2).toNumber(),
      status: finalStatus,
      forfeitedToCeo,
      forfeitureReason,
      conversionDate,
      rewardfulData: conversion.rawPayload as Prisma.InputJsonValue,
    });
  }

  await prisma.commission.createMany({ data: commissionRecords });

  return {
    success: true,
    commissionsCreated: commissionRecords.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the full teacher chain for an affiliate (max depth 2).
 * Returns all active teacher relationships ordered by depth.
 */
async function getTeacherChain(
  affiliateId: string
): Promise<TeacherCutInfo[]> {
  const relations = await prisma.teacherStudent.findMany({
    where: {
      studentId: affiliateId,
      isActive: true,
    },
    select: {
      teacherId: true,
      teacherCut: true,
      depth: true,
    },
    orderBy: { depth: "asc" },
  });

  return relations.map((r) => ({
    teacherId: r.teacherId,
    teacherCutPercent: new Decimal(r.teacherCut.toString()),
    depth: r.depth,
  }));
}

/**
 * Check if the affiliate submitted attendance for the conversion date.
 * Converts to the affiliate's stored timezone to determine "the day".
 */
async function checkAttendance(
  userId: string,
  conversionDate: Date
): Promise<boolean> {
  // Get the conversion date as YYYY-MM-DD in UTC
  // The attendance records store dates in the user's local timezone as YYYY-MM-DD.
  // We need to check if there's attendance for the same calendar date.
  //
  // Strategy: look for attendance on the UTC date and +/- 1 day to handle
  // timezone differences, then verify the match using the stored timezone.
  const utcDate = conversionDate.toISOString().slice(0, 10);

  // Also check adjacent dates to handle timezone edge cases
  const prevDate = new Date(conversionDate);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const nextDate = new Date(conversionDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  const datesToCheck = [
    prevDate.toISOString().slice(0, 10),
    utcDate,
    nextDate.toISOString().slice(0, 10),
  ];

  const attendance = await prisma.attendance.findFirst({
    where: {
      userId,
      date: { in: datesToCheck },
    },
  });

  return attendance !== null;
}

/**
 * Re-evaluate a PENDING commission (e.g., when attendance is submitted
 * after the conversion was processed). If attendance now exists, upgrade
 * from FORFEITED/PENDING to EARNED.
 */
export async function reevaluateCommission(
  rewardfulCommissionId: string
): Promise<{ updated: boolean }> {
  const commissions = await prisma.commission.findMany({
    where: {
      rewardfulCommissionId,
      teacherId: null, // Only the affiliate's own record
      status: { in: ["FORFEITED", "PENDING"] },
    },
  });

  if (commissions.length === 0) return { updated: false };

  const commission = commissions[0];
  const hasAttendance = await checkAttendance(
    commission.affiliateId,
    commission.conversionDate
  );

  if (!hasAttendance) return { updated: false };

  // Recalculate: restore affiliate cut, reduce CEO cut
  const fullAmount = new Decimal(commission.fullAmountCad.toString());
  const affiliatePercent = new Decimal(
    commission.affiliateCutPercent.toString()
  );
  const affiliateCut = fullAmount.mul(affiliatePercent).div(100);
  const oldCeoCut = new Decimal(commission.ceoCutCad.toString());
  const newCeoCut = oldCeoCut.sub(affiliateCut);

  // Update all records for this rewardfulCommissionId (affiliate + teachers)
  await prisma.commission.updateMany({
    where: { rewardfulCommissionId },
    data: {
      status: "EARNED",
      forfeitedToCeo: false,
      forfeitureReason: null,
      affiliateCutCad: affiliateCut.toDecimalPlaces(2).toNumber(),
      ceoCutCad: newCeoCut.toDecimalPlaces(2).toNumber(),
    },
  });

  return { updated: true };
}
