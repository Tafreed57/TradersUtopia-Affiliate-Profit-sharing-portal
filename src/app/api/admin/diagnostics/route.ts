import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/diagnostics
 *
 * Lightweight health counters for the admin dashboard. These values are
 * informational only and should help explain whether the automatic systems
 * are healthy without requiring admins to run repair tools first.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin || !session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [
    linkedAccounts,
    accountsWithLinkIssues,
    usersWithPushTokens,
    totalDeviceTokenRows,
    legacyDeviceTokenRows,
    currentAdminDeviceTokens,
    groupedTokens,
  ] = await Promise.all([
    prisma.user.count({
      where: { rewardfulAffiliateId: { not: null } },
    }),
    prisma.user.count({
      where: {
        OR: [{ linkError: { not: null } }, { backfillError: { not: null } }],
      },
    }),
    prisma.deviceToken.findMany({
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.deviceToken.count(),
    prisma.deviceToken.count({
      where: { deviceId: null },
    }),
    prisma.deviceToken.count({
      where: { userId: session.user.id },
    }),
    prisma.deviceToken.groupBy({
      by: ["userId"],
      _count: { _all: true },
    }),
  ]);

  const usersWithMultipleTokens = groupedTokens.filter(
    (row) => row._count._all > 1
  ).length;

  return NextResponse.json({
    linkedAccounts,
    accountsWithLinkIssues,
    usersWithPushTokens: usersWithPushTokens.length,
    totalDeviceTokenRows,
    legacyDeviceTokenRows,
    usersWithMultipleTokens,
    currentAdminDeviceTokens,
  });
}
