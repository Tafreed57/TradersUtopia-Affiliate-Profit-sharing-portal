import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/dashboard/stats
 *
 * Returns dashboard summary stats for the authenticated user.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);

  const affiliateSplitWhere = { role: "AFFILIATE" as const, recipientId: userId };

  const [
    lifetimeStatsUser,
    totalEarnedFallback,
    thisMonthEarned,
    commissionCount,
    attendanceThisMonth,
    recentSplits,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { lifetimeStatsJson: true },
    }),

    // Fallback when Rewardful cache is cold.
    prisma.commissionSplit.aggregate({
      where: { ...affiliateSplitWhere, status: "EARNED" },
      _sum: { cutCad: true },
    }),

    prisma.commissionSplit.aggregate({
      where: {
        ...affiliateSplitWhere,
        status: "EARNED",
        event: { conversionDate: { gte: monthStart, lte: monthEnd } },
      },
      _sum: { cutCad: true },
    }),

    prisma.commissionSplit.count({ where: affiliateSplitWhere }),

    prisma.attendance.groupBy({
      by: ["date"],
      where: {
        userId,
        date: { gte: monthStartStr, lte: monthEndStr },
      },
    }),

    prisma.commissionSplit.findMany({
      where: affiliateSplitWhere,
      orderBy: [
        { event: { conversionDate: "desc" } },
        { createdAt: "desc" },
      ],
      take: 5,
      select: {
        id: true,
        cutCad: true,
        status: true,
        forfeitedToCeo: true,
        event: { select: { conversionDate: true } },
      },
    }),
  ]);

  const lifetimeStats = lifetimeStatsUser?.lifetimeStatsJson as
    | { grossEarnedCad?: number }
    | null
    | undefined;
  const localFallback = totalEarnedFallback._sum.cutCad?.toNumber() ?? 0;

  // When Rewardful cache is warm, totalEarned is in CAD (from commission_stats).
  // When cold, falls back to DB sum of cutCad (stored currency).
  const hasRewardfulCache = lifetimeStats?.grossEarnedCad != null;

  return NextResponse.json({
    totalEarned: lifetimeStats?.grossEarnedCad ?? localFallback,
    totalEarnedCurrency: hasRewardfulCache ? "CAD" : "USD",
    thisMonthEarned: thisMonthEarned._sum.cutCad?.toNumber() ?? 0,
    commissionCount,
    attendanceDaysThisMonth: attendanceThisMonth.length,
    recentCommissions: recentSplits.map((s) => ({
      id: s.id,
      affiliateCutCad: s.cutCad,
      status: s.status,
      forfeitedToCeo: s.forfeitedToCeo,
      conversionDate: s.event.conversionDate,
    })),
  });
}
