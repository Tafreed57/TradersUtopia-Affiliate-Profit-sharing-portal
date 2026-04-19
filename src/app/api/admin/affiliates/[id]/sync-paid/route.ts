import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { listCommissions } from "@/lib/rewardful";

/**
 * POST /api/admin/affiliates/:id/sync-paid
 *
 * Affiliate-scoped version of the global /api/admin/commissions/sync-paid.
 * Pulls Rewardful `state=paid` commissions for THIS affiliate only and
 * flips matching EARNED splits to PAID. Useful for debugging a single
 * affiliate's state without scanning the entire paid-commission list.
 */
const MAX_PAGES = 50;

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

  let page = 1;
  let totalFetched = 0;
  let totalUpdated = 0;

  while (page <= MAX_PAGES) {
    const resp = await listCommissions({
      state: "paid",
      limit: 100,
      page,
      affiliate_id: user.rewardfulAffiliateId,
    });
    const items = resp.data ?? [];
    totalFetched += items.length;

    // Batch by paid_at — many commissions share a timestamp, so the
    // updateMany per timestamp collapses ~100 calls per page to ~1–2.
    const byPaidAt = new Map<string, string[]>();
    for (const item of items) {
      if (!item.paid_at) continue;
      const arr = byPaidAt.get(item.paid_at) ?? [];
      arr.push(item.id);
      byPaidAt.set(item.paid_at, arr);
    }

    for (const [paidAtStr, rcids] of byPaidAt) {
      const events = await prisma.commissionEvent.findMany({
        where: { rewardfulCommissionId: { in: rcids } },
        select: { id: true },
      });
      if (events.length === 0) continue;
      const result = await prisma.commissionSplit.updateMany({
        where: {
          eventId: { in: events.map((e) => e.id) },
          status: "EARNED",
        },
        data: { status: "PAID", paidAt: new Date(paidAtStr) },
      });
      totalUpdated += result.count;
    }

    if (!resp.pagination.next_page) break;
    page++;
  }

  return NextResponse.json({
    ok: true,
    email: user.email,
    fetched: totalFetched,
    updated: totalUpdated,
  });
}
