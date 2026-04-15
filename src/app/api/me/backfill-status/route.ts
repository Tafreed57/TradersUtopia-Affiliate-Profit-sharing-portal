import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/me/backfill-status
 *
 * Polled by the import banner. No vendor-name strings.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      backfillStatus: true,
      backfillStartedAt: true,
      backfillCompletedAt: true,
      rewardfulAffiliateId: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    linked: Boolean(user.rewardfulAffiliateId),
    status: user.backfillStatus,
    startedAt: user.backfillStartedAt,
    completedAt: user.backfillCompletedAt,
  });
}
