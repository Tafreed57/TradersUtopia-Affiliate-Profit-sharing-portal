import { processConversion } from "@/lib/commission-engine";
import {
  syncCommissionMissingUpstream,
  syncCommissionStatesFromCommissions,
} from "@/lib/paid-sync-service";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

export interface AffiliateSyncResult {
  fetched: number;
  created: number;
  paidSynced: number;
  voidedSynced: number;
  missingVoided: number;
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
}): Promise<AffiliateSyncResult> {
  const commissions = await rewardful.listAllCommissionsForAffiliate(
    args.rewardfulAffiliateId
  );

  commissions.sort((a, b) => {
    const aDate = a.sale?.charged_at ?? a.created_at ?? "";
    const bDate = b.sale?.charged_at ?? b.created_at ?? "";
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });

  let created = 0;
  let paidSynced = 0;
  let voidedSynced = 0;
  let missingVoided = 0;

  for (const commission of commissions) {
    const existing = await prisma.commissionEvent.findUnique({
      where: { rewardfulCommissionId: commission.id },
      select: {
        id: true,
        splits: {
          where: { role: "AFFILIATE" },
          select: { status: true },
          take: 1,
        },
      },
    });

    if (!existing) {
      if (!commission.sale) continue;
      const amountRaw = commission.sale.sale_amount_cents;
      if (typeof amountRaw !== "number") continue;
      const snapshot = rewardful.snapshotFromRewardfulCommission(commission);

      const result = await processConversion(
        {
          rewardfulCommissionId: commission.id,
          rewardfulReferralId: commission.sale?.referral?.id ?? commission.referral?.id,
          affiliateRewardfulId: args.rewardfulAffiliateId,
          amount: amountRaw / 100,
          currency: commission.sale.currency ?? commission.currency ?? "USD",
          conversionDate:
            commission.sale.charged_at ??
            commission.created_at ??
            new Date().toISOString(),
          upstreamState: snapshot.state,
          upstreamDueAt: snapshot.dueAt,
          upstreamPaidAt: snapshot.paidAt,
          upstreamVoidedAt: snapshot.voidedAt,
          campaignId: snapshot.campaignId,
          campaignName: snapshot.campaignName,
          rawPayload: commission as unknown as Record<string, unknown>,
        },
        { skipAttendanceCheck: true }
      );
      if (result.success && !result.skipped) {
        created++;
      }
    }
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

  return {
    fetched: commissions.length,
    created,
    paidSynced,
    voidedSynced,
    missingVoided,
  };
}
