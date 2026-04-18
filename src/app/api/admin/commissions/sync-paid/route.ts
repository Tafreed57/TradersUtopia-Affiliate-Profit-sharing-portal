import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { listCommissions } from "@/lib/rewardful";

const MAX_PAGES = 200; // 200 × 100 = 20 000 commissions max

/**
 * POST /api/admin/commissions/sync-paid
 *
 * One-time (idempotent) sync: pulls all state=paid commissions from Rewardful
 * and marks matching portal splits PAID. No notifications sent. Use to
 * establish a clean historical baseline before payment webhook goes live.
 *
 * Batches DB writes by paid_at timestamp — batch payments share a timestamp,
 * so this collapses ~100 DB calls per page down to ~1-2.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let page = 1;
  let totalFetched = 0;
  let totalUpdated = 0;

  while (page <= MAX_PAGES) {
    const resp = await listCommissions({ state: "paid", limit: 100, page });
    const items = resp.data ?? [];
    totalFetched += items.length;

    const byPaidAt = new Map<string, string[]>();
    for (const item of items) {
      if (!item.paid_at) continue;
      const key = item.paid_at;
      if (!byPaidAt.has(key)) byPaidAt.set(key, []);
      byPaidAt.get(key)!.push(item.id);
    }

    for (const [paidAtStr, rcids] of byPaidAt) {
      // Resolve rcids → eventIds, then update their EARNED splits.
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

  return NextResponse.json({ ok: true, fetched: totalFetched, updated: totalUpdated });
}
