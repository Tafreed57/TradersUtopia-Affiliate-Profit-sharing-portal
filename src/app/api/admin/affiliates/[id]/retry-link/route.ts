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

  // Release any stale lock + clear the prior error so linkRewardfulAffiliate
  // can re-claim. Only touches users still missing the external id; a
  // successfully linked user keeps their timestamps.
  await prisma.user.update({
    where: { id: user.id },
    data: { linkInProgressAt: null, linkError: null },
  });

  await linkRewardfulAffiliate({
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  const after = await prisma.user.findUnique({
    where: { id: user.id },
    select: { rewardfulAffiliateId: true, linkError: true },
  });

  if (after?.rewardfulAffiliateId) {
    return NextResponse.json({
      ok: true,
      rewardfulAffiliateId: after.rewardfulAffiliateId,
    });
  }
  return NextResponse.json(
    {
      ok: false,
      error: after?.linkError ?? "Link did not complete — check server logs.",
    },
    { status: 502 }
  );
}
