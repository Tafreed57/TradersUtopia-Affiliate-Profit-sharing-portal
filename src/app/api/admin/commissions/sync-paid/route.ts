import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { syncPaidHistoryGlobally } from "@/lib/paid-sync-service";

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

  const { fetched, updated } = await syncPaidHistoryGlobally();

  return NextResponse.json({ ok: true, fetched, updated });
}
