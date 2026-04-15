import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { linkRewardfulAffiliate } from "@/lib/auth-rewardful-link";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/me/backfill-status
 *
 * Polled by the import banner. No vendor-name strings.
 * Self-heals users whose JWT predates the sign-in linking code by
 * attempting linkRewardfulAffiliate once on each call if still unlinked.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      name: true,
      backfillStatus: true,
      backfillStartedAt: true,
      backfillCompletedAt: true,
      rewardfulAffiliateId: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!user.rewardfulAffiliateId) {
    await linkRewardfulAffiliate({
      userId: session.user.id,
      email: user.email,
      name: user.name,
    });
    user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        email: true,
        name: true,
        backfillStatus: true,
        backfillStartedAt: true,
        backfillCompletedAt: true,
        rewardfulAffiliateId: true,
      },
    });
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  return NextResponse.json({
    linked: Boolean(user.rewardfulAffiliateId),
    status: user.backfillStatus,
    startedAt: user.backfillStartedAt,
    completedAt: user.backfillCompletedAt,
  });
}
