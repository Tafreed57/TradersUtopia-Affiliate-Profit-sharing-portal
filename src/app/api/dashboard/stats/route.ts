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

  // Current month boundaries
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);

  const [
    totalEarned,
    thisMonthEarned,
    commissionCount,
    attendanceThisMonth,
    recentCommissions,
  ] = await Promise.all([
    // Total earned (all time, only EARNED status, affiliate's own records)
    prisma.commission.aggregate({
      where: {
        affiliateId: userId,
        teacherId: null,
        status: "EARNED",
      },
      _sum: { affiliateCutCad: true },
    }),

    // This month earned
    prisma.commission.aggregate({
      where: {
        affiliateId: userId,
        teacherId: null,
        status: "EARNED",
        conversionDate: { gte: monthStart, lte: monthEnd },
      },
      _sum: { affiliateCutCad: true },
    }),

    // Total commission count (all statuses)
    prisma.commission.count({
      where: {
        affiliateId: userId,
        teacherId: null,
      },
    }),

    // Attendance days this month
    prisma.attendance.groupBy({
      by: ["date"],
      where: {
        userId,
        date: { gte: monthStartStr, lte: monthEndStr },
      },
    }),

    // 5 most recent commissions
    prisma.commission.findMany({
      where: {
        affiliateId: userId,
        teacherId: null,
      },
      orderBy: { conversionDate: "desc" },
      take: 5,
      select: {
        id: true,
        affiliateCutCad: true,
        status: true,
        forfeitedToCeo: true,
        conversionDate: true,
      },
    }),
  ]);

  return NextResponse.json({
    totalEarnedCad: totalEarned._sum.affiliateCutCad?.toNumber() ?? 0,
    thisMonthEarnedCad:
      thisMonthEarned._sum.affiliateCutCad?.toNumber() ?? 0,
    commissionCount,
    attendanceDaysThisMonth: attendanceThisMonth.length,
    recentCommissions,
  });
}
