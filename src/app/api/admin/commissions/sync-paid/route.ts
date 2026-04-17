import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { syncCommissionPaid } from "@/lib/payment-service";
import { listCommissions } from "@/lib/rewardful";

const MAX_PAGES = 200; // 200 × 100 = 20 000 commissions max

/**
 * POST /api/admin/commissions/sync-paid
 *
 * One-time (idempotent) sync: pulls all state=paid commissions from Rewardful
 * and marks matching portal Commission rows PAID. No notifications sent.
 * Use to establish a clean historical baseline before payment webhook goes live.
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

    for (const item of items) {
      if (!item.paid_at) continue;
      const updated = await syncCommissionPaid(item.id, new Date(item.paid_at));
      totalUpdated += updated;
    }

    if (!resp.pagination.next_page) break;
    page++;
  }

  return NextResponse.json({ ok: true, fetched: totalFetched, updated: totalUpdated });
}
