import { after, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { runBackfill } from "@/lib/backfill-service";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

/**
 * POST /api/internal/backfill
 *
 * Kicks off the historical commission import for the authenticated user.
 * Uses `after()` so the job keeps running after the response is sent —
 * the Vercel Fluid Compute instance is kept alive until the job finishes.
 * Caller polls user state (via session/profile) to detect completion.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { rewardfulAffiliateId: true, backfillStatus: true },
  });
  if (!user?.rewardfulAffiliateId) {
    return NextResponse.json(
      { error: "Account not yet linked" },
      { status: 409 }
    );
  }
  if (user.backfillStatus === "COMPLETED") {
    return NextResponse.json({ status: "COMPLETED" }, { status: 200 });
  }

  const userId = session.user.id;
  after(async () => {
    try {
      await runBackfill(userId);
    } catch (err) {
      console.error(`[backfill] route-triggered run crashed for ${userId}:`, err);
    }
  });

  return NextResponse.json({ status: "IN_PROGRESS" }, { status: 202 });
}
