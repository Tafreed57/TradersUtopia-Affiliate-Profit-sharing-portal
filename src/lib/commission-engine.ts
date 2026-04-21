/**
 * Commission Calculation Engine
 *
 * Processes Rewardful webhook conversions into CommissionEvent + CommissionSplit rows.
 * One event per conversion; one split per recipient (affiliate + each teacher).
 * Per-event fields (fullAmount, ceoCut, currency, conversionDate) live on the
 * event; per-recipient fields (status, cutAmount, paidAt, forfeitureReason)
 * live on the splits. CEO cut is implicit — no CEO split rows.
 *
 * Amounts are stored in the event's native `currency` (USD for US Stripe,
 * CAD for Canadian). Callers that display money must either filter by
 * currency or normalize via getCadToUsdRate() — see
 * anti-patterns/column-name-as-contract.
 */

import { CommissionStatus, NotificationType, Prisma } from "@prisma/client";
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
  /** Sale amount in the source currency (usually USD). */
  amount: number;
  /** ISO 4217 currency code of the amount (defaults to USD). */
  currency?: string;
  conversionDate: string; // ISO 8601
  rawPayload: Record<string, unknown>;
}

interface TeacherCutInfo {
  teacherId: string;
  teacherCutPercent: Decimal;
  depth: number;
}

interface NotificationItem {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface ProcessingResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  commissionsCreated?: number;
  warnings?: string[];
  notifications?: NotificationItem[];
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface ProcessConversionOptions {
  /**
   * When true, skip the attendance check and treat the conversion as if
   * attendance was recorded. Used by the historical backfill job where
   * attendance records don't exist for pre-portal dates.
   */
  skipAttendanceCheck?: boolean;
}

export async function processConversion(
  conversion: WebhookConversion,
  opts: ProcessConversionOptions = {}
): Promise<ProcessingResult> {
  const warnings: string[] = [];

  // 1. Idempotency — skip if already processed.
  const existingEvent = await prisma.commissionEvent.findUnique({
    where: { rewardfulCommissionId: conversion.rewardfulCommissionId },
    select: { id: true },
  });
  if (existingEvent) {
    return { success: true, skipped: true, reason: "Duplicate webhook" };
  }

  // 2. Find affiliate by Rewardful ID. Deactivated affiliates are still
  // looked up so the commission is recorded + forfeited to CEO (see below);
  // only an unlinked Rewardful ID still silent-drops.
  const affiliate = await prisma.user.findFirst({
    where: {
      rewardfulAffiliateId: conversion.affiliateRewardfulId,
    },
  });
  if (!affiliate) {
    return {
      success: false,
      reason: `No affiliate linked for Rewardful ID ${conversion.affiliateRewardfulId}`,
    };
  }

  const fullAmount = new Decimal(conversion.amount);
  // Upper-case for canonical storage — Stripe/Rewardful may send "usd" or "cad".
  const currency = (conversion.currency ?? "USD").toUpperCase();
  const conversionDate = new Date(conversion.conversionDate);

  // 2a. Classify initial vs recurring by conversionDate, not insertion order.
  // Rewardful list endpoints can return newest-first; a naive "any prior event
  // exists" count would misclassify an earlier conversion that happens to
  // arrive second. Using `conversionDate: { lt: this.conversionDate }` makes
  // the classification chronologically stable regardless of delivery order
  // for events that arrive AFTER their own older siblings. For the opposite
  // case (older event arrives first, then newer), the older one correctly
  // gets isRecurring=false (initial) and the newer one gets true (recurring).
  // A nightly reconcile that re-runs the ROW_NUMBER classification is the
  // safety net for the residual edge case where out-of-order arrival puts
  // the newer one FIRST (newer gets wrongly classified initial until repair).
  // All callers of processConversion in this repo now sort inputs by
  // conversionDate ascending to minimize this risk.
  const isRecurring = conversion.rewardfulReferralId
    ? (await prisma.commissionEvent.count({
        where: {
          rewardfulReferralId: conversion.rewardfulReferralId,
          conversionDate: { lt: conversionDate },
          NOT: { rewardfulCommissionId: conversion.rewardfulCommissionId },
        },
      })) > 0
    : false;

  // 3. Get teacher chain (active teachers at depth 1 and 2).
  const teacherChain = await getTeacherChain(affiliate.id);

  // 4. Calculate splits. Rate depends on classification: initial vs recurring.
  const applicableRate = isRecurring
    ? affiliate.recurringCommissionPercent
    : affiliate.initialCommissionPercent;
  const affiliatePercent = new Decimal(applicableRate.toString());
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

  if (totalAllocatedPercent.gt(TEACHER_CUT_WARN_THRESHOLD)) {
    warnings.push(
      `Total allocation for ${affiliate.email} is ${totalAllocatedPercent}% (threshold: ${TEACHER_CUT_WARN_THRESHOLD}%)`
    );
  }

  // CEO gets the remainder (can be negative — signals admin needs to fix).
  const ceoCut = fullAmount.sub(affiliateCut).sub(totalTeacherCuts);

  // 5. Rate-gate: if admin hasn't set the affiliate's commission rate, park
  // the AFFILIATE split as PENDING. Teacher splits don't wait on the rate-gate
  // (teachers have their own cuts). CEO holds the affiliate's share until
  // admin runs "Recalculate at current rate".
  const isRateNotSet = affiliatePercent.eq(0);

  // 6. Attendance evaluated up-front so teacher-split status stays consistent
  // across the rate-gate and non-rate-gate branches.
  const hasAttendance = opts.skipAttendanceCheck
    ? true
    : await checkAttendance(affiliate.id, conversionDate);

  let affiliateStatus: CommissionStatus;
  let affiliateForfeitedToCeo = false;
  let affiliateReason: string | null = null;
  let teacherStatus: CommissionStatus;
  let teacherReason: string | null = null;
  let finalAffiliateCut: Decimal;
  let finalCeoCut: Decimal;

  if (affiliate.status !== "ACTIVE") {
    // Deactivated (or otherwise non-active) affiliate: forfeit the AFFILIATE
    // split to CEO so the commission is still recorded with an audit trail.
    // Teacher splits follow the normal attendance gate — the teacher chain
    // itself has already been filtered for ACTIVE TeacherStudent rows, so
    // admins who want teachers to stop earning must cascade-unpair.
    affiliateStatus = "FORFEITED";
    affiliateForfeitedToCeo = true;
    affiliateReason = "affiliate_deactivated";
    teacherStatus = hasAttendance ? "EARNED" : "FORFEITED";
    teacherReason = hasAttendance
      ? null
      : "No attendance submitted for conversion date";
    finalAffiliateCut = new Decimal(0);
    finalCeoCut = ceoCut.add(affiliateCut);
    warnings.push(
      `Commission received for deactivated affiliate ${affiliate.email}`
    );
  } else if (isRateNotSet) {
    affiliateStatus = "PENDING";
    affiliateReason = "rate_not_set";
    teacherStatus = hasAttendance ? "EARNED" : "FORFEITED";
    teacherReason = hasAttendance
      ? null
      : "No attendance submitted for conversion date";
    finalAffiliateCut = new Decimal(0);
    finalCeoCut = ceoCut;
  } else if (!hasAttendance) {
    affiliateStatus = "FORFEITED";
    affiliateForfeitedToCeo = true;
    affiliateReason = "No attendance submitted for conversion date";
    teacherStatus = "FORFEITED";
    teacherReason = "No attendance submitted for conversion date";
    finalAffiliateCut = new Decimal(0);
    finalCeoCut = ceoCut.add(affiliateCut);
  } else {
    affiliateStatus = "EARNED";
    teacherStatus = "EARNED";
    finalAffiliateCut = affiliateCut;
    finalCeoCut = ceoCut;
  }

  // 6a. CEO-cut invariant: fail loud if rates are misconfigured such that
  // affiliate% + sum(teacher%) > 100. Silent cap-to-zero would hide the
  // misconfig indefinitely; throwing surfaces the bad rate in Sentry + webhook
  // 500 response + WebhookLog so the admin fixes it. Subsequent webhooks
  // succeed automatically; the daily reconcile cron backfills the gap. Matches
  // the loud-failure pattern in runRecalcPending's rate re-verification guard
  // (session-19).
  if (finalCeoCut.lt(0)) {
    throw new Error(
      `CEO cut negative (${finalCeoCut.toString()}) for commission ${conversion.rewardfulCommissionId}: ` +
        `fullAmount=${fullAmount.toString()} ${currency}, ` +
        `affiliateCut=${affiliateCut.toString()} (${affiliatePercent.toString()}% of ${affiliate.email}), ` +
        `totalTeacherCuts=${totalTeacherCuts.toString()} over ${teacherCuts.length} teachers. ` +
        `Admin must reduce teacher % sum so affiliate% + teachers% <= 100.`
    );
  }

  // 7. Persist event + splits in one transaction.
  // Unique constraint on CommissionEvent.rewardfulCommissionId means a
  // concurrent webhook delivery racing past the findUnique check above will
  // fail the create with P2002 — we treat that as a duplicate skip.
  const splitData: Prisma.CommissionSplitCreateWithoutEventInput[] = [];

  splitData.push({
    recipient: { connect: { id: affiliate.id } },
    role: "AFFILIATE",
    cutPercent: affiliatePercent.toDecimalPlaces(2).toNumber(),
    cutAmount: finalAffiliateCut.toDecimalPlaces(2).toNumber(),
    status: affiliateStatus,
    forfeitedToCeo: affiliateForfeitedToCeo,
    forfeitureReason: affiliateReason,
    idempotencyKey: `${conversion.rewardfulCommissionId}:aff:${affiliate.id}`,
  });

  for (const tc of teacherCuts) {
    splitData.push({
      recipient: { connect: { id: tc.teacherId } },
      role: "TEACHER",
      depth: tc.depth,
      cutPercent: tc.teacherCutPercent.toDecimalPlaces(2).toNumber(),
      cutAmount: tc.amount.toDecimalPlaces(2).toNumber(),
      status: teacherStatus,
      forfeitedToCeo: false,
      forfeitureReason: teacherReason,
      idempotencyKey: `${conversion.rewardfulCommissionId}:teacher:${tc.teacherId}`,
    });
  }

  try {
    await prisma.commissionEvent.create({
      data: {
        rewardfulCommissionId: conversion.rewardfulCommissionId,
        rewardfulReferralId: conversion.rewardfulReferralId ?? null,
        affiliateId: affiliate.id,
        conversionDate,
        currency,
        fullAmount: fullAmount.toDecimalPlaces(2).toNumber(),
        ceoCut: finalCeoCut.toDecimalPlaces(2).toNumber(),
        isRecurring,
        rewardfulData: conversion.rawPayload as Prisma.InputJsonValue,
        splits: { create: splitData },
      },
    });
  } catch (err) {
    // P2002 on rewardfulCommissionId or idempotencyKey → a concurrent webhook
    // delivery beat us to it. Inspect `target` so unrelated unique violations
    // (e.g., a bug introducing a new unique field) surface as errors instead
    // of being silently masked as duplicates.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const target = err.meta?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
      if (
        targetStr.includes("rewardfulCommissionId") ||
        targetStr.includes("idempotencyKey")
      ) {
        return { success: true, skipped: true, reason: "Duplicate webhook (concurrent)" };
      }
    }
    throw err;
  }

  // 8. Notifications.
  const notifications: NotificationItem[] = [];

  if (isRateNotSet) {
    // Rate not set — no notification; UI banner surfaces the unset-rate state.
  } else if (affiliateReason === "affiliate_deactivated") {
    // Deactivated affiliate — suppress notification entirely. They've been
    // offboarded; an "attendance missed, recover it" push would be wrong +
    // misleading. Audit trail lives in the CommissionSplit row.
  } else if (affiliateForfeitedToCeo) {
    notifications.push({
      userId: affiliate.id,
      type: "ATTENDANCE_FORFEITURE_ALERT",
      title: "Commission Forfeited",
      body: `You missed attendance on ${conversionDate.toLocaleDateString()} and your commission of $${affiliateCut.toFixed(2)} ${currency} was forfeited. Submit attendance to recover it.`,
      data: { rewardfulCommissionId: conversion.rewardfulCommissionId },
    });
  } else {
    notifications.push({
      userId: affiliate.id,
      type: "CONVERSION_RECEIVED",
      title: "New Commission Earned!",
      body: `You earned $${finalAffiliateCut.toFixed(2)} ${currency} from a new conversion.`,
      data: { rewardfulCommissionId: conversion.rewardfulCommissionId },
    });
  }

  for (const tc of teacherCuts) {
    notifications.push({
      userId: tc.teacherId,
      type: "CONVERSION_RECEIVED",
      title: "Student Conversion",
      body: `Your student earned a conversion. Your cut: $${tc.amount.toFixed(2)} ${currency}.`,
      data: { rewardfulCommissionId: conversion.rewardfulCommissionId },
    });
  }

  return {
    success: true,
    commissionsCreated: 1 + teacherCuts.length,
    warnings: warnings.length > 0 ? warnings : undefined,
    notifications,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getTeacherChain(
  affiliateId: string
): Promise<TeacherCutInfo[]> {
  const relations = await prisma.teacherStudent.findMany({
    where: { studentId: affiliateId, status: "ACTIVE" },
    select: { teacherId: true, teacherCut: true, depth: true },
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
 *
 * Grace rule: if the affiliate has never submitted attendance for any date
 * on or before the conversion date, they are exempt and this returns true.
 * Once tracking is active, the normal ±1-day window applies.
 */
async function checkAttendance(
  userId: string,
  conversionDate: Date
): Promise<boolean> {
  const utcDate = conversionDate.toISOString().slice(0, 10);

  const anyPrior = await prisma.attendance.findFirst({
    where: { userId, date: { lte: utcDate } },
    select: { date: true },
  });
  if (!anyPrior) return true;

  const prevDate = new Date(conversionDate);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const nextDate = new Date(conversionDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  const attendance = await prisma.attendance.findFirst({
    where: {
      userId,
      date: {
        in: [
          prevDate.toISOString().slice(0, 10),
          utcDate,
          nextDate.toISOString().slice(0, 10),
        ],
      },
    },
  });

  return attendance !== null;
}

/**
 * Re-evaluate a previously-forfeited affiliate split (e.g., when attendance
 * is submitted after the conversion). If attendance now exists, flip the
 * AFFILIATE split + any attendance-forfeited TEACHER splits from FORFEITED
 * to EARNED, and reduce the event's ceoCut by the recovered affiliate cut.
 */
export async function reevaluateCommission(
  rewardfulCommissionId: string
): Promise<{ updated: boolean }> {
  const event = await prisma.commissionEvent.findUnique({
    where: { rewardfulCommissionId },
    include: {
      splits: {
        where: {
          role: "AFFILIATE",
          status: { in: ["FORFEITED", "PENDING"] },
          // rate_not_set is resolved by the admin recalc flow, not attendance.
          // affiliate_deactivated must NEVER be reversed by attendance — the
          // affiliate is offboarded and attendance submissions (if any still
          // slip through) must not restore their cut (Codex catch).
          NOT: {
            forfeitureReason: { in: ["rate_not_set", "affiliate_deactivated"] },
          },
        },
      },
    },
  });

  if (!event || event.splits.length === 0) return { updated: false };

  const affiliateSplit = event.splits[0];
  const hasAttendance = await checkAttendance(
    event.affiliateId,
    event.conversionDate
  );

  if (!hasAttendance) return { updated: false };

  // Restore affiliate cut, reduce CEO cut, flip attendance-forfeited teachers.
  const fullAmount = new Decimal(event.fullAmount.toString());
  const affiliatePercent = new Decimal(affiliateSplit.cutPercent.toString());
  const affiliateCut = fullAmount.mul(affiliatePercent).div(100);
  const oldCeoCut = new Decimal(event.ceoCut.toString());
  const newCeoCut = oldCeoCut.sub(affiliateCut);
  const noAttendanceReason = "No attendance submitted for conversion date";

  await prisma.$transaction([
    prisma.commissionSplit.update({
      where: { id: affiliateSplit.id },
      data: {
        status: "EARNED",
        forfeitedToCeo: false,
        forfeitureReason: null,
        cutAmount: affiliateCut.toDecimalPlaces(2).toNumber(),
      },
    }),
    prisma.commissionSplit.updateMany({
      where: {
        eventId: event.id,
        role: "TEACHER",
        status: "FORFEITED",
        forfeitureReason: noAttendanceReason,
      },
      data: {
        status: "EARNED",
        forfeitedToCeo: false,
        forfeitureReason: null,
      },
    }),
    prisma.commissionEvent.update({
      where: { id: event.id },
      data: { ceoCut: newCeoCut.toDecimalPlaces(2).toNumber() },
    }),
  ]);

  return { updated: true };
}
