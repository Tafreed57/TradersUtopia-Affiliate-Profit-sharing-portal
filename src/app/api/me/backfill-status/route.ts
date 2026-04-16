import { after, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { linkRewardfulAffiliate } from "@/lib/auth-rewardful-link";
import { runBackfill } from "@/lib/backfill-service";
import { prisma } from "@/lib/prisma";

const USER_STATUS_SELECT = {
  email: true,
  name: true,
  backfillStatus: true,
  backfillStartedAt: true,
  backfillCompletedAt: true,
  rewardfulAffiliateId: true,
  commissionPercent: true,
} as const;

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
    select: USER_STATUS_SELECT,
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
      select: USER_STATUS_SELECT,
    });
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // Stale-lock recovery: if a prior background job claimed the lock but
  // never finished (crashed silently in `after()`), restart it here.
  // Matches the 10-min threshold in `runBackfill`'s atomic claim, and
  // re-runs the job via `after()` so the user doesn't have to refresh —
  // the existing BackfillBanner `kickedRef` guard would otherwise prevent
  // a client-side retry once it has fired.
  if (
    user.backfillStatus === "IN_PROGRESS" &&
    user.backfillStartedAt &&
    Date.now() - user.backfillStartedAt.getTime() > 10 * 60 * 1000
  ) {
    const userId = session.user.id;
    after(async () => {
      try {
        await runBackfill(userId);
      } catch (err) {
        console.error(`[backfill] stale-lock recovery failed for ${userId}:`, err);
      }
    });
  }

  return NextResponse.json({
    linked: Boolean(user.rewardfulAffiliateId),
    status: user.backfillStatus,
    startedAt: user.backfillStartedAt,
    completedAt: user.backfillCompletedAt,
    commissionPercent: Number(user.commissionPercent),
  });
}
