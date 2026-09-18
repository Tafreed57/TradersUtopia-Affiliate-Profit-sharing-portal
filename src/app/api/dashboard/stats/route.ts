import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { getCommissionCadAllocation } from "@/lib/commission-cad-service";
import { applyRecurringCommissionVisibility } from "@/lib/commission-visibility";
import { getTorontoMonthComparisonWindows } from "@/lib/company-performance";
import { prisma } from "@/lib/prisma";

/** Returns dashboard summary stats for the authenticated user. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const monthWindows = getTorontoMonthComparisonWindows();
  const monthStart = monthWindows.current.start;
  const monthEnd = monthWindows.current.end;
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);
  const visibilityUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: true,
    },
  });
  const affiliateSplitWhere = { role: "AFFILIATE" as const, recipientId: userId };
  const visibleAffiliateSplitWhere = applyRecurringCommissionVisibility(
    affiliateSplitWhere,
    {
      canSeeRecurringCommissions:
        visibilityUser?.canSeeRecurringCommissions ?? false,
      recurringCommissionsVisibleFrom:
        visibilityUser?.recurringCommissionsVisibleFrom ?? null,
    }
  );

  const [
    payableSplits,
    commissionCount,
    attendanceThisMonth,
    recentSplits,
    cadAllocation,
  ] = await Promise.all([
    prisma.commissionSplit.findMany({
      where: {
        ...affiliateSplitWhere,
        status: { in: ["EARNED", "PAID"] },
      },
      select: {
        id: true,
        status: true,
        paidAt: true,
        event: { select: { conversionDate: true } },
      },
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
      where: visibleAffiliateSplitWhere,
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
    getCommissionCadAllocation(userId),
  ]);

  const cadFor = (id: string) =>
    cadAllocation.splitCadById.get(id)?.toNumber() ?? 0;
  const totalEarned = payableSplits.reduce(
    (sum, split) => sum + cadFor(split.id),
    0
  );
  const thisMonthEarned = payableSplits.reduce(
    (sum, split) =>
      split.event.conversionDate >= monthStart &&
      split.event.conversionDate < monthEnd
        ? sum + cadFor(split.id)
        : sum,
    0
  );
  const paidThisMonth = payableSplits.reduce(
    (sum, split) =>
      split.status === "PAID" &&
      split.paidAt &&
      split.paidAt >= monthStart &&
      split.paidAt < monthEnd
        ? sum + cadFor(split.id)
        : sum,
    0
  );

  return NextResponse.json({
    totalEarned: Math.round(totalEarned * 100) / 100,
    totalEarnedCurrency: "CAD" as const,
    thisMonthEarned: Math.round(thisMonthEarned * 100) / 100,
    paidThisMonth: Math.round(paidThisMonth * 100) / 100,
    commissionCount,
    attendanceDaysThisMonth: attendanceThisMonth.length,
    dataStale: cadAllocation.stale,
    recentCommissions: recentSplits.map((split) => ({
      id: split.id,
      affiliateCut: split.cutAmount,
      affiliateCutCad:
        cadAllocation.splitCadById
          .get(split.id)
          ?.toDecimalPlaces(2)
          .toNumber() ?? null,
      currency: split.event.currency.toUpperCase() as "USD" | "CAD",
      status: split.status,
      forfeitedToCeo: split.forfeitedToCeo,
      conversionDate: split.event.conversionDate,
    })),
  });
}
