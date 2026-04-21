import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { syncAffiliateCommissionCatalog } from "@/lib/affiliate-sync-service";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/affiliates/:id/sync-paid
 *
 * Affiliate-scoped state sync. Imports any missing commissions, syncs paid
 * and voided statuses, and voids local orphan rows whose upstream commission
 * no longer exists.
 */
export const maxDuration = 300;

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
      { error: "User has no linked affiliate account yet" },
      { status: 409 }
    );
  }

  const result = await syncAffiliateCommissionCatalog({
    affiliateId: user.id,
    rewardfulAffiliateId: user.rewardfulAffiliateId,
  });

  return NextResponse.json({
    ok: true,
    email: user.email,
    ...result,
    updated: result.paidSynced,
  });
}
