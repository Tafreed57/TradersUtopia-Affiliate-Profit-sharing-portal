import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth-options";
import { linkRewardfulAffiliate } from "@/lib/auth-rewardful-link";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface LifetimeStatsPayload {
  visitors: number;
  leads: number;
  conversions: number;
  conversionRate: number;
  coupons: Array<{ id: string; code: string }>;
  fetchedAt: string;
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

  const grossEarnedAgg = await prisma.commission.aggregate({
    where: { affiliateId: userId, teacherId: null, status: "EARNED" },
    _sum: { affiliateCutCad: true },
  });
  const grossEarnedCad = Number(grossEarnedAgg._sum.affiliateCutCad ?? 0);

  const cachedFresh =
    user.lifetimeStatsJson &&
    user.lifetimeStatsCachedAt &&
    Date.now() - user.lifetimeStatsCachedAt.getTime() < CACHE_TTL_MS;

  if (cachedFresh) {
    const cached = user.lifetimeStatsJson as unknown as LifetimeStatsPayload;
    return NextResponse.json({
      ...cached,
      grossEarnedCad,
      cachedAt: user.lifetimeStatsCachedAt,
      stale: false,
    });
  }

  try {
    const stats = await rewardful.getAffiliateLifetimeStats(
      user.rewardfulAffiliateId
    );
    const payload: LifetimeStatsPayload = {
      visitors: stats.visitors,
      leads: stats.leads,
      conversions: stats.conversions,
      conversionRate: stats.conversionRate,
      coupons: stats.coupons,
      fetchedAt: stats.fetchedAt,
    };

    await prisma.user.update({
      where: { id: userId },
      data: {
        lifetimeStatsJson: payload as unknown as object,
        lifetimeStatsCachedAt: new Date(),
      },
    });

    return NextResponse.json({
      ...payload,
      grossEarnedCad,
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
        await linkRewardfulAffiliate({
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

    if (user.lifetimeStatsJson) {
      const cached = user.lifetimeStatsJson as unknown as LifetimeStatsPayload;
      return NextResponse.json({
        ...cached,
        grossEarnedCad,
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
