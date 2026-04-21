import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { getCadToUsdRate } from "@/lib/currency";
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

  // `CommissionSplit.cutAmount` stores the event's native currency (USD or CAD
  // per CommissionEvent.currency) despite the column name — see the *Cad
  // DEBT. Aggregate per-currency and normalize USD→CAD server-side using
  // the cached exchange rate so the FE can treat `totalEarned` as canonical
  // CAD without worrying about mixed-currency users.
  const perCurrencyTotalWhere = {
    ...affiliateSplitWhere,
    status: { in: ["EARNED" as const, "PAID" as const] },
  };
  const perCurrencyMonthWhere = {
    ...perCurrencyTotalWhere,
    event: { conversionDate: { gte: monthStart, lte: monthEnd } },
  };

  const [
    totalUsdAgg,
    totalCadAgg,
    monthUsdAgg,
    monthCadAgg,
    commissionCount,
    attendanceThisMonth,
    recentSplits,
    rate,
  ] = await Promise.all([
    prisma.commissionSplit.aggregate({
      where: { ...perCurrencyTotalWhere, event: { currency: "USD" } },
      _sum: { cutAmount: true },
    }),
    prisma.commissionSplit.aggregate({
      where: { ...perCurrencyTotalWhere, event: { currency: "CAD" } },
      _sum: { cutAmount: true },
    }),
    prisma.commissionSplit.aggregate({
      where: { ...perCurrencyMonthWhere, event: { currency: "USD", conversionDate: { gte: monthStart, lte: monthEnd } } },
      _sum: { cutAmount: true },
    }),
    prisma.commissionSplit.aggregate({
      where: { ...perCurrencyMonthWhere, event: { currency: "CAD", conversionDate: { gte: monthStart, lte: monthEnd } } },
      _sum: { cutAmount: true },
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
        cutAmount: true,
        status: true,
        forfeitedToCeo: true,
        event: { select: { conversionDate: true, currency: true } },
      },
    }),

    getCadToUsdRate(),
  ]);

  // Convert USD portions to CAD. cadToUsd is CAD→USD rate, so CAD = USD / rate.
  // Fallback 0.74 matches the lib's hardcoded fallback when API is unavailable.
  const cadToUsd = rate?.rate.toNumber() ?? 0.74;
  const toCad = (usd: number) => Math.round((usd / cadToUsd) * 100) / 100;

  const totalUsd = totalUsdAgg._sum.cutAmount?.toNumber() ?? 0;
  const totalCad = totalCadAgg._sum.cutAmount?.toNumber() ?? 0;
  const monthUsd = monthUsdAgg._sum.cutAmount?.toNumber() ?? 0;
  const monthCad = monthCadAgg._sum.cutAmount?.toNumber() ?? 0;

  // No HTTP cache header here. `Cache-Control: private, max-age=N` would
  // let the browser HTTP cache reuse this response by URL alone — without
  // `Vary: Cookie` a sign-out + sign-in-as-another-user within the TTL
  // could serve the previous user's earnings summary (Codex catch).
  // React Query's in-memory cache (`staleTime: 30s` from the global
  // QueryProvider default) already dedupes within-tab fetches; multi-tab
  // deduping isn't worth the leak risk.
  return NextResponse.json({
    totalEarned: Math.round((totalCad + toCad(totalUsd)) * 100) / 100,
    totalEarnedCurrency: "CAD" as const,
    thisMonthEarned: Math.round((monthCad + toCad(monthUsd)) * 100) / 100,
    commissionCount,
    attendanceDaysThisMonth: attendanceThisMonth.length,
    recentCommissions: recentSplits.map((s) => ({
      id: s.id,
      affiliateCut: s.cutAmount,
      // Defensive upper-case in case of legacy lowercase row.
      currency: s.event.currency.toUpperCase() as "USD" | "CAD",
      status: s.status,
      forfeitedToCeo: s.forfeitedToCeo,
      conversionDate: s.event.conversionDate,
    })),
  });
}
