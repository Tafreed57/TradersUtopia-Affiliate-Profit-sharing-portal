import { Prisma } from "@prisma/client";

import { rewardfulAffiliateDisplayName } from "@/lib/admin-student-search";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

export class UpstreamAffiliateLinkError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UpstreamAffiliateLinkError";
    this.status = status;
  }
}

export async function findOrCreatePortalUserForUpstreamAffiliate(
  affiliateId: string
) {
  let affiliate: rewardful.RewardfulAffiliate;
  try {
    affiliate = await rewardful.getAffiliate(affiliateId);
  } catch (error) {
    if (error instanceof rewardful.RewardfulApiError && error.status === 404) {
      throw new UpstreamAffiliateLinkError(
        "Affiliate account not found.",
        404
      );
    }
    throw error;
  }
  const normalizedEmail = affiliate.email.toLowerCase();
  const displayName = rewardfulAffiliateDisplayName(affiliate);

  const existingByAffiliate = await prisma.user.findUnique({
    where: { rewardfulAffiliateId: affiliate.id },
    select: { id: true },
  });
  if (existingByAffiliate) {
    return existingByAffiliate;
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      name: true,
      rewardfulAffiliateId: true,
    },
  });

  if (existingByEmail) {
    if (
      existingByEmail.rewardfulAffiliateId &&
      existingByEmail.rewardfulAffiliateId !== affiliate.id
    ) {
      throw new UpstreamAffiliateLinkError(
        "A portal user with this email is already linked to a different commission account.",
        409
      );
    }

    return prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        name: existingByEmail.name ?? displayName,
        rewardfulAffiliateId: affiliate.id,
        rewardfulEmail: normalizedEmail,
        backfillStatus: "NOT_STARTED",
        backfillError: null,
        linkError: null,
        linkInProgressAt: null,
        lifetimeStatsJson: Prisma.JsonNull,
        lifetimeStatsCachedAt: null,
      },
      select: { id: true },
    });
  }

  try {
    return await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: displayName,
        rewardfulAffiliateId: affiliate.id,
        rewardfulEmail: normalizedEmail,
        backfillStatus: "NOT_STARTED",
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.user.findFirst({
        where: {
          OR: [
            { email: normalizedEmail },
            { rewardfulAffiliateId: affiliate.id },
          ],
        },
        select: { id: true },
      });
      if (raced) return raced;
    }
    throw error;
  }
}
