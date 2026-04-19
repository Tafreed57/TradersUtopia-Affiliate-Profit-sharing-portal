import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { linkRewardfulAffiliate } from "@/lib/auth-rewardful-link";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

/**
 * POST /api/admin/affiliates/:id/retry-link
 *
 * Admin-triggered retry of the commission-system auto-link for a single
 * affiliate. Clears the stale linkInProgressAt lock + previous linkError,
 * then re-runs the link synchronously so the admin sees the outcome.
 *
 * Used after fixing upstream-facing bugs (e.g. the last_name:"" 422) so the
 * admin doesn't have to wait for the next sign-in or poll cycle.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, rewardfulAffiliateId: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (user.rewardfulAffiliateId) {
    return NextResponse.json(
      { ok: true, alreadyLinked: true, rewardfulAffiliateId: user.rewardfulAffiliateId }
    );
  }

  // Do NOT clear linkInProgressAt here — that would race a concurrent
  // /api/me/backfill-status poll on the same user and let two createAffiliate
  // calls run in parallel, producing duplicate upstream affiliates. Instead,
  // rely on linkRewardfulAffiliate's singleflight claim: on failure the lock
  // is now released in its catch block, so any legitimate retry can re-claim
  // immediately; on in-flight work, the retry simply no-ops and the caller
  // gets a 409.
  await linkRewardfulAffiliate({
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  const after = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      rewardfulAffiliateId: true,
      linkError: true,
      linkInProgressAt: true,
    },
  });

  if (after?.rewardfulAffiliateId) {
    return NextResponse.json({
      ok: true,
      rewardfulAffiliateId: after.rewardfulAffiliateId,
    });
  }

  const LOCK_TTL_MS = 5 * 60_000;
  if (
    after?.linkInProgressAt &&
    Date.now() - after.linkInProgressAt.getTime() < LOCK_TTL_MS
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Another link attempt is currently in progress for this user. Try again in a moment.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: after?.linkError ?? "Link did not complete — check server logs.",
    },
    { status: 502 }
  );
}
