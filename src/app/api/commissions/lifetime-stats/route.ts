import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth-options";
import { linkRewardfulAffiliateWithTimeout } from "@/lib/auth-rewardful-link";
import { getCadToUsdRate } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 6;

interface LifetimeStatsPayload {
  visitors: number;
  leads: number;
  conversions: number;
  conversionRate: number;
  /** Sum of own AFFILIATE CommissionSplit.cutAmount where status in (EARNED, PAID), normalized to CAD. */
  grossEarnedCad: number;
  paidCad: number;
  unpaidCad: number;
  /**
   * Currency the `*Cad` amounts are actually stored in (USD for webhook-sourced
   * events, CAD for Rewardful-backfilled events tagged in session 33). FE must
   * pass this to CurrencyProvider.format so USD values don't get displayed as CAD.
   */
  currency: "USD" | "CAD";
  coupons: Array<{ id: string; code: string }>;
  fetchedAt: string;
}

interface CacheRecord extends LifetimeStatsPayload {
  cacheVersion: number;
}

/**
 * GET /api/commissions/lifetime-stats
 *
 * Authenticated user's all-time performance — visitors, leads, conversions —
 * augmented with `grossEarnedCad`, computed locally from their own cut only.
 * Cached for 5 minutes; on upstream failure returns last cached with stale:true.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      rewardfulAffiliateId: true,
      lifetimeStatsJson: true,
      lifetimeStatsCachedAt: true,
    },
  });
  if (!user?.rewardfulAffiliateId) {
    return NextResponse.json(
      { error: "Account not yet linked" },
      { status: 409 }
    );
  }

  const cachedRecord = user.lifetimeStatsJson as unknown as CacheRecord | null;
  const cachedFresh =
    cachedRecord &&
    cachedRecord.cacheVersion === CACHE_VERSION &&
    user.lifetimeStatsCachedAt &&
    Date.now() - user.lifetimeStatsCachedAt.getTime() < CACHE_TTL_MS;

  if (cachedFresh) {
    return NextResponse.json({
      ...cachedRecord,
      cachedAt: user.lifetimeStatsCachedAt,
      stale: false,
    });
  }

  const affiliateSplitWhere = {
    role: "AFFILIATE" as const,
    recipientId: userId,
  };

  try {
    const [stats, earnedUsdAgg, earnedCadAgg, paidUsdAgg, paidCadAgg, rate] =
      await Promise.all([
        rewardful.getAffiliateLifetimeStats(user.rewardfulAffiliateId),
        prisma.commissionSplit.aggregate({
          where: { ...affiliateSplitWhere, status: "EARNED", event: { currency: "USD" } },
          _sum: { cutAmount: true },
        }),
        prisma.commissionSplit.aggregate({
          where: { ...affiliateSplitWhere, status: "EARNED", event: { currency: "CAD" } },
          _sum: { cutAmount: true },
        }),
        prisma.commissionSplit.aggregate({
          where: { ...affiliateSplitWhere, status: "PAID", event: { currency: "USD" } },
          _sum: { cutAmount: true },
        }),
        prisma.commissionSplit.aggregate({
          where: { ...affiliateSplitWhere, status: "PAID", event: { currency: "CAD" } },
          _sum: { cutAmount: true },
        }),
        getCadToUsdRate(),
      ]);

    // Normalize USD portions to CAD so the payload is canonical single-currency.
    const cadToUsd = rate?.rate.toNumber() ?? 0.74;
    const toCad = (usd: number) => Math.round((usd / cadToUsd) * 100) / 100;

    const unpaidCad = Math.round(
      ((earnedCadAgg._sum.cutAmount?.toNumber() ?? 0) +
        toCad(earnedUsdAgg._sum.cutAmount?.toNumber() ?? 0)) * 100
    ) / 100;
    const paidCad = Math.round(
      ((paidCadAgg._sum.cutAmount?.toNumber() ?? 0) +
        toCad(paidUsdAgg._sum.cutAmount?.toNumber() ?? 0)) * 100
    ) / 100;
    const grossEarnedCad = Math.round((unpaidCad + paidCad) * 100) / 100;

    const payload: LifetimeStatsPayload = {
      visitors: stats.visitors,
      leads: stats.leads,
      conversions: stats.conversions,
      conversionRate: stats.conversionRate,
      grossEarnedCad,
      paidCad,
      unpaidCad,
      currency: "CAD",
      coupons: stats.coupons,
      fetchedAt: stats.fetchedAt,
    };

    const cacheRecord: CacheRecord = {
      ...payload,
      cacheVersion: CACHE_VERSION,
    };

    await prisma.user.update({
      where: { id: userId },
      data: {
        lifetimeStatsJson: cacheRecord as unknown as object,
        lifetimeStatsCachedAt: new Date(),
      },
    });

    return NextResponse.json({
      ...payload,
      cachedAt: new Date().toISOString(),
      stale: false,
    });
  } catch (err) {
    const is404 =
      err instanceof Error && /404/.test(err.message);
    console.error(`[lifetime-stats] fetch failed for ${userId}:`, err);

    if (is404) {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      await prisma.user.update({
        where: { id: userId },
        data: {
          rewardfulAffiliateId: null,
          rewardfulEmail: null,
          backfillStatus: "NOT_STARTED",
          lifetimeStatsJson: Prisma.DbNull,
          lifetimeStatsCachedAt: null,
        },
      });
      console.log(
        `[lifetime-stats] cleared stale affiliate for ${userId}, re-linking`
      );
      if (dbUser?.email) {
        await linkRewardfulAffiliateWithTimeout({
          userId,
          email: dbUser.email,
          name: dbUser.name,
        });
      }
      return NextResponse.json(
        { error: "Account re-linked, please refresh" },
        { status: 409 }
      );
    }

    // Return stale cache if available (current format only).
    if (cachedRecord?.cacheVersion === CACHE_VERSION) {
      return NextResponse.json({
        ...cachedRecord,
        cachedAt: user.lifetimeStatsCachedAt,
        stale: true,
      });
    }
    return NextResponse.json(
      { error: "Stats temporarily unavailable" },
      { status: 503 }
    );
  }
}
