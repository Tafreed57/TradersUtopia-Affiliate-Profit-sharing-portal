import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { syncPaidHistoryForAffiliate } from "@/lib/paid-sync-service";

/**
 * POST /api/admin/affiliates/:id/sync-paid
 *
 * Affiliate-scoped version of the global /api/admin/commissions/sync-paid.
 * Pulls Rewardful `state=paid` commissions for THIS affiliate only and
 * flips matching EARNED splits to PAID. Useful for debugging a single
 * affiliate's state without scanning the entire paid-commission list.
 */
export const maxDuration = 120;

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
    select: { id: true, email: true, rewardfulAffiliateId: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.rewardfulAffiliateId) {
    return NextResponse.json(
      { error: "User has no Rewardful affiliate link yet" },
      { status: 409 }
    );
  }

  const { fetched, updated } = await syncPaidHistoryForAffiliate(
    user.rewardfulAffiliateId
  );

  return NextResponse.json({
    ok: true,
    email: user.email,
    fetched,
    updated,
  });
}
