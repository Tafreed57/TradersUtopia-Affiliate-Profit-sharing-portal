import { Prisma } from "@prisma/client";

import { runBackfill } from "@/lib/backfill-service";
import { hasConfiguredCommissionRates } from "@/lib/commission-rate-config";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

export interface ReplaceAffiliateLinkResult {
  targetAffiliateId: string;
  targetAffiliateEmail: string;
  deleted: {
    events: number;
    splitsCascaded: number;
  };
  waitingForRate: boolean;
  backfill: Awaited<ReturnType<typeof runBackfill>> | null;
}

async function resolveAffiliate(identifier: string) {
  const normalized = identifier.trim();
  if (normalized.includes("@")) {
    return rewardful.getAffiliateByEmail(normalized.toLowerCase());
  }

  try {
    return await rewardful.getAffiliate(normalized);
  } catch (err) {
    if (
      err instanceof rewardful.RewardfulApiError &&
      err.status === 404
    ) {
      return null;
    }
    throw err;
  }
}

export async function replaceAffiliateLink(args: {
  userId: string;
  identifier: string;
}): Promise<ReplaceAffiliateLinkResult> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      email: true,
      rewardfulAffiliateId: true,
      backfillStatus: true,
      initialCommissionPercent: true,
      recurringCommissionPercent: true,
      ratesConfiguredAt: true,
    },
  });
  if (!user) {
    throw new Error("User not found.");
  }

  if (user.backfillStatus === "IN_PROGRESS") {
    throw new Error(
      "History import is currently running for this user. Wait for it to finish before replacing the linked account."
    );
  }

  const targetAffiliate = await resolveAffiliate(args.identifier);
  if (!targetAffiliate) {
    throw new Error("Could not find that affiliate account.");
  }

  if (user.rewardfulAffiliateId === targetAffiliate.id) {
    throw new Error("This user is already linked to that affiliate account.");
  }

  const existingOwner = await prisma.user.findFirst({
    where: {
      rewardfulAffiliateId: targetAffiliate.id,
      NOT: { id: user.id },
    },
    select: { email: true, name: true },
  });
  if (existingOwner) {
    throw new Error(
      `That affiliate account is already linked to ${existingOwner.name ?? existingOwner.email}.`
    );
  }

  const splitsCascaded = await prisma.commissionSplit.count({
    where: { event: { affiliateId: user.id } },
  });

  const { eventsDeleted } = await prisma.$transaction(async (tx) => {
    const eventsDeleted = await tx.commissionEvent.deleteMany({
      where: { affiliateId: user.id },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        rewardfulAffiliateId: targetAffiliate.id,
        rewardfulEmail: targetAffiliate.email.toLowerCase(),
        backfillStatus: "NOT_STARTED",
        backfillStartedAt: null,
        backfillCompletedAt: null,
        backfillError: null,
        linkError: null,
        linkInProgressAt: null,
        lifetimeStatsJson: Prisma.JsonNull,
        lifetimeStatsCachedAt: null,
      },
    });

    return { eventsDeleted: eventsDeleted.count };
  });

  const waitingForRate = !hasConfiguredCommissionRates(user);

  let backfill: Awaited<ReturnType<typeof runBackfill>> | null = null;
  if (!waitingForRate) {
    backfill = await runBackfill(user.id);
  }

  return {
    targetAffiliateId: targetAffiliate.id,
    targetAffiliateEmail: targetAffiliate.email.toLowerCase(),
    deleted: {
      events: eventsDeleted,
      splitsCascaded,
    },
    waitingForRate,
    backfill,
  };
}
