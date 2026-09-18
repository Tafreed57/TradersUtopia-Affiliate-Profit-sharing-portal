import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";

import { isCommissionEligible } from "@/lib/account-access";
import { processConversion } from "@/lib/commission-engine";
import { getCommissionCadAllocation } from "@/lib/commission-cad-service";
import { hasConfiguredCommissionRates } from "@/lib/commission-rate-config";
import { resolveCommissionStatus } from "@/lib/commission-status-rules";
import {
  mapTeacherRelationToCutInfo,
  type TeacherCutInfo,
} from "@/lib/commission-teacher-chain";
import {
  syncCommissionMissingUpstream,
  syncCommissionStatesFromCommissions,
} from "@/lib/paid-sync-service";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

const CREATE_EVENT_CHUNK_SIZE = 100;
const CREATE_SPLIT_CHUNK_SIZE = 500;

export interface AffiliateSyncResult {
  fetched: number;
  created: number;
  paidSynced: number;
  voidedSynced: number;
  missingVoided: number;
}

export interface AffiliateSyncOptions {
  notifyOnImportedCommissions?: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function commissionReferralId(commission: rewardful.RewardfulCommission) {
  return commission.sale?.referral?.id ?? commission.referral?.id ?? null;
}

function commissionConversionDate(commission: rewardful.RewardfulCommission) {
  return commission.sale?.charged_at ?? commission.created_at ?? new Date().toISOString();
}

function commissionCurrency(commission: rewardful.RewardfulCommission) {
  return (commission.sale?.currency ?? commission.currency ?? "USD").toUpperCase();
}

function jsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function importMissingCommissionsWithEngine({
  affiliateRewardfulId,
  commissions,
  existingRewardfulIds,
  notifyOnImportedCommissions,
}: {
  affiliateRewardfulId: string;
  commissions: rewardful.RewardfulCommission[];
  existingRewardfulIds: Set<string>;
  notifyOnImportedCommissions: boolean;
}) {
  let created = 0;

  for (const commission of commissions) {
    if (existingRewardfulIds.has(commission.id)) continue;
    if (!commission.sale) continue;

    const amountRaw = rewardful.rewardfulCommissionBaseAmountCents(commission);
    if (amountRaw === null) continue;
    const snapshot = rewardful.snapshotFromRewardfulCommission(commission);

    const result = await processConversion(
      {
        rewardfulCommissionId: commission.id,
        rewardfulReferralId: commissionReferralId(commission) ?? undefined,
        affiliateRewardfulId,
        amount: amountRaw / 100,
        currency: commissionCurrency(commission),
        conversionDate: commissionConversionDate(commission),
        upstreamState: snapshot.state,
        upstreamDueAt: snapshot.dueAt,
        upstreamPaidAt: snapshot.paidAt,
        upstreamVoidedAt: snapshot.voidedAt,
        campaignId: snapshot.campaignId,
        campaignName: snapshot.campaignName,
        rawPayload: commission as unknown as Record<string, unknown>,
      },
      { notify: notifyOnImportedCommissions }
    );
    if (result.success && !result.skipped) {
      created++;
      existingRewardfulIds.add(commission.id);
    }
  }

  return created;
}

async function importMissingCommissionsInBulk({
  affiliateId,
  rewardfulAffiliateId,
  commissions,
  existingRewardfulIds,
  startedAt,
}: {
  affiliateId: string;
  rewardfulAffiliateId: string;
  commissions: rewardful.RewardfulCommission[];
  existingRewardfulIds: Set<string>;
  startedAt: number;
}) {
  const [affiliate, teacherRelations] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id: affiliateId,
        rewardfulAffiliateId,
      },
      select: {
        id: true,
        email: true,
        status: true,
        accountType: true,
        initialCommissionPercent: true,
        recurringCommissionPercent: true,
        ratesConfiguredAt: true,
      },
    }),
    prisma.teacherStudent.findMany({
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
    }),
  ]);

  if (!affiliate) return 0;

  const commissionEligible = isCommissionEligible(affiliate);
  const teacherChain: TeacherCutInfo[] = (commissionEligible ? teacherRelations : []).map(
    mapTeacherRelationToCutInfo
  );
  const statusDecision = resolveCommissionStatus({
    affiliateUserStatus: affiliate.status,
    ratesConfigured: hasConfiguredCommissionRates(affiliate),
  });
  const seenReferralIds = new Set<string>();
  const eventRows: Prisma.CommissionEventCreateManyInput[] = [];
  const splitRows: Prisma.CommissionSplitCreateManyInput[] = [];

  for (const commission of commissions) {
    const referralId = commissionReferralId(commission);
    if (existingRewardfulIds.has(commission.id)) {
      if (referralId) seenReferralIds.add(referralId);
      continue;
    }
    if (!commission.sale) continue;

    const amountRaw = rewardful.rewardfulCommissionBaseAmountCents(commission);
    if (amountRaw === null) continue;

    const eventId = randomUUID();
    const conversionDate = new Date(commissionConversionDate(commission));
    const isRecurring = referralId ? seenReferralIds.has(referralId) : false;
    const snapshot = rewardful.snapshotFromRewardfulCommission(commission);
    const currency = commissionCurrency(commission);
    const fullAmount = new Decimal(amountRaw).div(100);
    const applicableRate = isRecurring
      ? affiliate.recurringCommissionPercent
      : affiliate.initialCommissionPercent;
    const affiliatePercent = new Decimal(commissionEligible ? applicableRate.toString() : 0);
    const affiliateCut = fullAmount.mul(affiliatePercent).div(100);
    const teacherCuts = teacherChain.map((teacherCut) => ({
      ...teacherCut,
      amount: fullAmount.mul(teacherCut.teacherCutPercent).div(100),
    }));
    const totalTeacherCuts = teacherCuts.reduce(
      (sum, teacherCut) => sum.add(teacherCut.amount),
      new Decimal(0)
    );
    const ceoCut = fullAmount.sub(affiliateCut).sub(totalTeacherCuts);

    let finalAffiliateCut: Decimal;
    let finalCeoCut: Decimal;
    if (statusDecision.affiliateReason === "affiliate_deactivated") {
      finalAffiliateCut = new Decimal(0);
      finalCeoCut = ceoCut.add(affiliateCut);
    } else if (statusDecision.affiliateStatus === "PENDING") {
      finalAffiliateCut = new Decimal(0);
      finalCeoCut = ceoCut;
    } else {
      finalAffiliateCut = affiliateCut;
      finalCeoCut = ceoCut;
    }

    if (finalCeoCut.lt(0)) {
      throw new Error(
        `CEO cut negative (${finalCeoCut.toString()}) for commission ${commission.id}: ` +
          `fullAmount=${fullAmount.toString()} ${currency}, ` +
          `affiliateCut=${affiliateCut.toString()} (${affiliatePercent.toString()}% of ${affiliate.email}), ` +
          `totalTeacherCuts=${totalTeacherCuts.toString()} over ${teacherCuts.length} teachers. ` +
          `Admin must reduce teacher % sum so affiliate% + teachers% <= 100.`
      );
    }

    eventRows.push({
      id: eventId,
      rewardfulCommissionId: commission.id,
      rewardfulReferralId: referralId,
      affiliateId: affiliate.id,
      conversionDate,
      currency,
      fullAmount: fullAmount.toDecimalPlaces(2).toNumber(),
      ceoCut: finalCeoCut.toDecimalPlaces(2).toNumber(),
      isRecurring,
      upstreamState: snapshot.state,
      upstreamDueAt: snapshot.dueAt ? new Date(snapshot.dueAt) : null,
      upstreamPaidAt: snapshot.paidAt ? new Date(snapshot.paidAt) : null,
      upstreamVoidedAt: snapshot.voidedAt ? new Date(snapshot.voidedAt) : null,
      campaignId: snapshot.campaignId,
      campaignName: snapshot.campaignName,
      rewardfulData: jsonSnapshot(commission),
    });

    if (commissionEligible) splitRows.push({
      eventId,
      recipientId: affiliate.id,
      role: "AFFILIATE",
      cutPercent: affiliatePercent.toDecimalPlaces(2).toNumber(),
      cutAmount: finalAffiliateCut.toDecimalPlaces(2).toNumber(),
      status: statusDecision.affiliateStatus,
      forfeitedToCeo: statusDecision.affiliateForfeitedToCeo,
      forfeitureReason: statusDecision.affiliateReason,
      idempotencyKey: `${commission.id}:aff:${affiliate.id}`,
    });

    for (const teacherCut of teacherCuts) {
      splitRows.push({
        eventId,
        recipientId: teacherCut.teacherId,
        teacherStudentId: teacherCut.relationshipId,
        teacherStudentSequence: teacherCut.relationshipSequence,
        role: "TEACHER",
        depth: teacherCut.depth,
        cutPercent: teacherCut.teacherCutPercent.toDecimalPlaces(2).toNumber(),
        cutAmount: teacherCut.amount.toDecimalPlaces(2).toNumber(),
        status: statusDecision.teacherStatus,
        forfeitedToCeo: false,
        forfeitureReason: statusDecision.teacherReason,
        idempotencyKey: `${commission.id}:teacher:${teacherCut.teacherId}`,
      });
    }

    existingRewardfulIds.add(commission.id);
    if (referralId) seenReferralIds.add(referralId);
  }

  for (const batch of chunk(eventRows, CREATE_EVENT_CHUNK_SIZE)) {
    await prisma.commissionEvent.createMany({ data: batch });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "affiliate_sync_events_inserted",
        affiliateId,
        inserted: batch.length,
        totalPrepared: eventRows.length,
        ms: Date.now() - startedAt,
      })
    );
  }

  for (const batch of chunk(splitRows, CREATE_SPLIT_CHUNK_SIZE)) {
    await prisma.commissionSplit.createMany({ data: batch });
  }

  return eventRows.length;
}

/**
 * Reconciles one linked affiliate against the upstream source of truth.
 *
 * Handles four cases:
 * 1. import missing local events
 * 2. flip paid rows to PAID
 * 3. flip voided rows to VOIDED
 * 4. void local rows whose upstream commission no longer exists
 */
export async function syncAffiliateCommissionCatalog(args: {
  affiliateId: string;
  rewardfulAffiliateId: string;
}, options?: AffiliateSyncOptions): Promise<AffiliateSyncResult> {
  const startedAt = Date.now();
  const notifyOnImportedCommissions =
    options?.notifyOnImportedCommissions ?? false;

  console.log(
    JSON.stringify({
      level: "info",
      msg: "affiliate_sync_start",
      affiliateId: args.affiliateId,
      notifyOnImportedCommissions,
    })
  );

  try {
    await rewardful.disableAffiliateCommissionNotificationEmails(
      args.rewardfulAffiliateId
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[syncAffiliateCommissionCatalog] failed to enforce upstream email policy for ${args.rewardfulAffiliateId}: ${msg}`
    );
  }

  const commissions = await rewardful.listAllCommissionsForAffiliate(
    args.rewardfulAffiliateId
  );

  commissions.sort((a, b) => {
    const aDate = a.sale?.charged_at ?? a.created_at ?? "";
    const bDate = b.sale?.charged_at ?? b.created_at ?? "";
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });

  const commissionIds = commissions.map((commission) => commission.id);
  const existingEvents = await prisma.commissionEvent.findMany({
    where: {
      rewardfulCommissionId: { in: commissionIds },
    },
    select: { rewardfulCommissionId: true },
  });
  const existingRewardfulIds = new Set(
    existingEvents.flatMap((event) =>
      event.rewardfulCommissionId ? [event.rewardfulCommissionId] : []
    )
  );

  let created = 0;
  let paidSynced = 0;
  let voidedSynced = 0;
  let missingVoided = 0;

  if (notifyOnImportedCommissions) {
    created = await importMissingCommissionsWithEngine({
      affiliateRewardfulId: args.rewardfulAffiliateId,
      commissions,
      existingRewardfulIds,
      notifyOnImportedCommissions,
    });
  } else {
    created = await importMissingCommissionsInBulk({
      affiliateId: args.affiliateId,
      rewardfulAffiliateId: args.rewardfulAffiliateId,
      commissions,
      existingRewardfulIds,
      startedAt,
    });
  }

  const stateSync = await syncCommissionStatesFromCommissions(commissions);
  paidSynced += stateSync.paidUpdated;
  voidedSynced += stateSync.voidedUpdated;

  const upstreamCommissionIds = new Set(commissions.map((commission) => commission.id));
  const localEvents = await prisma.commissionEvent.findMany({
    where: {
      affiliateId: args.affiliateId,
      rewardfulCommissionId: { not: null },
    },
    select: {
      rewardfulCommissionId: true,
      upstreamState: true,
      splits: {
        where: { role: "AFFILIATE" },
        select: { status: true },
        take: 1,
      },
    },
  });

  for (const event of localEvents) {
    const rewardfulCommissionId = event.rewardfulCommissionId;
    const affiliateStatus = event.splits[0]?.status;
    if (!rewardfulCommissionId) continue;
    if (affiliateStatus === "VOIDED" && event.upstreamState === "voided") continue;
    if (upstreamCommissionIds.has(rewardfulCommissionId)) continue;

    try {
      const upstreamCommission = await rewardful.getCommission(rewardfulCommissionId);
      const syncResult = await syncCommissionStatesFromCommissions([
        upstreamCommission,
      ]);
      paidSynced += syncResult.paidUpdated;
      voidedSynced += syncResult.voidedUpdated;
    } catch (err) {
      if (
        err instanceof rewardful.RewardfulApiError &&
        err.status === 404
      ) {
        const updated = await syncCommissionMissingUpstream(
          rewardfulCommissionId,
          new Date()
        );
        if (updated > 0) {
          missingVoided++;
        }
        continue;
      }
      throw err;
    }
  }

  const syncedAffiliate = created > 0 ? await prisma.user.findUnique({
    where: { id: args.affiliateId },
    select: { accountType: true },
  }) : null;
  if (created > 0 && syncedAffiliate && isCommissionEligible(syncedAffiliate)) {
    try {
      await getCommissionCadAllocation(args.affiliateId);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "affiliate_sync_provider_cad_freeze_failed",
          affiliateId: args.affiliateId,
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - startedAt,
        })
      );
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "affiliate_sync_done",
      affiliateId: args.affiliateId,
      fetched: commissions.length,
      created,
      paidSynced,
      voidedSynced,
      missingVoided,
      ms: Date.now() - startedAt,
    })
  );

  return {
    fetched: commissions.length,
    created,
    paidSynced,
    voidedSynced,
    missingVoided,
  };
}
