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
 * CAD for Canadian). CAD accounting is derived separately from upstream
 * state totals; native event amounts remain available for native views.
 */

import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";

import { isCommissionEligible } from "@/lib/account-access";
import { hasConfiguredCommissionRates } from "@/lib/commission-rate-config";
import { resolveCommissionStatus } from "@/lib/commission-status-rules";
import {
  buildTeacherSplitCreateInput,
  mapTeacherRelationToCutInfo,
  type TeacherCutInfo,
} from "@/lib/commission-teacher-chain";
import { getCommissionCadAllocation } from "@/lib/commission-cad-service";
import {
  buildCommissionValueNotifications,
  type CommissionValueNotificationEvent,
  type CommissionValueNotificationSplit,
} from "@/lib/commission-value-notification-data";
import { TEACHER_CUT_WARN_THRESHOLD } from "@/lib/constants";
import { createNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import type { RewardfulCommissionState } from "@/lib/rewardful";

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
  upstreamState?: RewardfulCommissionState | null;
  upstreamDueAt?: string | null;
  upstreamPaidAt?: string | null;
  upstreamVoidedAt?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface ProcessingResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  commissionsCreated?: number;
  warnings?: string[];
}

export interface ProcessConversionOptions {
  notify?: boolean;
}

type CreatedCommissionEventForNotifications = CommissionValueNotificationEvent & {
  splits: CommissionValueNotificationSplit[];
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export async function processConversion(
  conversion: WebhookConversion,
  options: ProcessConversionOptions = {}
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
  const commissionEligible = isCommissionEligible(affiliate);
  const teacherChain = commissionEligible ? await getTeacherChain(affiliate.id) : [];

  // 4. Calculate splits. Rate depends on classification: initial vs recurring.
  const applicableRate = isRecurring
    ? affiliate.recurringCommissionPercent
    : affiliate.initialCommissionPercent;
  const affiliatePercent = new Decimal(commissionEligible ? applicableRate.toString() : 0);
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
  const isRateNotSet = !hasConfiguredCommissionRates(affiliate);

  const {
    affiliateStatus,
    affiliateForfeitedToCeo,
    affiliateReason,
    teacherStatus,
    teacherReason,
  } = resolveCommissionStatus({
    affiliateUserStatus: affiliate.status,
    ratesConfigured: !isRateNotSet,
  });
  let finalAffiliateCut: Decimal;
  let finalCeoCut: Decimal;

  if (affiliateReason === "affiliate_deactivated") {
    // Deactivated (or otherwise non-active) affiliate: forfeit the AFFILIATE
    // split to CEO so the commission is still recorded with an audit trail.
    // Teachers still earn; admins who want teachers to stop earning must
    // cascade-unpair the teacher chain.
    finalAffiliateCut = new Decimal(0);
    finalCeoCut = ceoCut.add(affiliateCut);
    warnings.push(
      `Commission received for deactivated affiliate ${affiliate.email}`
    );
  } else if (affiliateStatus === "PENDING") {
    finalAffiliateCut = new Decimal(0);
    finalCeoCut = ceoCut;
  } else {
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

  if (commissionEligible) splitData.push({
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
    splitData.push(
      buildTeacherSplitCreateInput({
        teacherCut: tc,
        cutAmount: tc.amount,
        status: teacherStatus,
        forfeitureReason: teacherReason,
        rewardfulCommissionId: conversion.rewardfulCommissionId,
      })
    );
  }

  let createdEventForNotifications: CreatedCommissionEventForNotifications | null =
    null;

  try {
    createdEventForNotifications = await prisma.commissionEvent.create({
      data: {
        rewardfulCommissionId: conversion.rewardfulCommissionId,
        rewardfulReferralId: conversion.rewardfulReferralId ?? null,
        affiliateId: affiliate.id,
        conversionDate,
        currency,
        fullAmount: fullAmount.toDecimalPlaces(2).toNumber(),
        ceoCut: finalCeoCut.toDecimalPlaces(2).toNumber(),
        isRecurring,
        upstreamState: conversion.upstreamState ?? null,
        upstreamDueAt: conversion.upstreamDueAt
          ? new Date(conversion.upstreamDueAt)
          : null,
        upstreamPaidAt: conversion.upstreamPaidAt
          ? new Date(conversion.upstreamPaidAt)
          : null,
        upstreamVoidedAt: conversion.upstreamVoidedAt
          ? new Date(conversion.upstreamVoidedAt)
          : null,
        campaignId: conversion.campaignId ?? null,
        campaignName: conversion.campaignName ?? null,
        rewardfulData: conversion.rawPayload as Prisma.InputJsonValue,
        splits: { create: splitData },
      },
      select: {
        id: true,
        rewardfulCommissionId: true,
        isRecurring: true,
        conversionDate: true,
        currency: true,
        splits: {
          select: {
            id: true,
            recipientId: true,
            role: true,
            cutPercent: true,
            cutAmount: true,
            providerCutCad: true,
            status: true,
            recipient: {
              select: {
                id: true,
                status: true,
                canSeeRecurringCommissions: true,
                recurringCommissionsVisibleFrom: true,
              },
            },
          },
        },
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

  if (!createdEventForNotifications) {
    throw new Error(
      `Commission ${conversion.rewardfulCommissionId} was not available for notification fan-out after create.`
    );
  }

  if (commissionEligible && options.notify !== false) {
    let notificationSplits = createdEventForNotifications.splits;
    try {
      const cadAllocation = await getCommissionCadAllocation(affiliate.id);
      notificationSplits = createdEventForNotifications.splits.map((split) => {
        const providerCutCad = cadAllocation.splitCadById.get(split.id);
        return providerCutCad
          ? {
              ...split,
              providerCutCad: providerCutCad.toDecimalPlaces(2).toString(),
            }
          : split;
      });

      if (cadAllocation.reason !== "ok") {
        warnings.push(
          `Provider CAD allocation ${cadAllocation.reason}; unresolved USD commission value notification(s) skipped`
        );
      }
    } catch (error) {
      console.error(
        `[commission-engine] failed to resolve provider CAD before notification fan-out for ${conversion.rewardfulCommissionId}:`,
        error
      );
      warnings.push(
        "Provider CAD allocation failed; unresolved USD commission value notification(s) skipped"
      );
    }

    const notifications = buildCommissionValueNotifications({
      event: createdEventForNotifications,
      splits: notificationSplits,
    });

    if (notifications.length > 0) {
      const deliveries = await createNotifications(notifications);
      const failedDeliveries = deliveries.filter(
        (delivery) => delivery.status === "rejected"
      ).length;

      if (failedDeliveries > 0) {
        warnings.push(
          `${failedDeliveries} commission value notification(s) failed to create`
        );
      }
    }
  }

  return {
    success: true,
    commissionsCreated: splitData.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getTeacherChain(
  affiliateId: string
): Promise<TeacherCutInfo[]> {
  const relations = await prisma.teacherStudent.findMany({
    where: {
      studentId: affiliateId,
      status: "ACTIVE",
      teacher: { accountType: "COMMISSION" },
      student: { accountType: "COMMISSION" },
    },
    select: {
      id: true,
      teacherId: true,
      teacherCut: true,
      depth: true,
      activationSequence: true,
    },
    orderBy: { depth: "asc" },
  });

  return relations.map(mapTeacherRelationToCutInfo);
}
