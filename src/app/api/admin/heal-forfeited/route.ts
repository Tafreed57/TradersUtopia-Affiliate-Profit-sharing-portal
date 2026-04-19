import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { healForfeitedByGrace } from "@/lib/heal-forfeited-by-grace";

/**
 * POST /api/admin/heal-forfeited
 *
 * Admin-only one-shot cleanup. Re-evaluates every AFFILIATE CommissionSplit
 * that's FORFEITED with forfeitureReason="No attendance submitted for
 * conversion date" against the attendance grace rule. Rows where the
 * affiliate had no attendance on/before the conversion date become EARNED
 * with rate-driven cutAmount; teacher splits for the same event recover too.
 *
 * Idempotent — subsequent runs heal only newly-FORFEITED rows (there
 * shouldn't be any going forward, since processConversion now respects the
 * grace rule at write time).
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await healForfeitedByGrace();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[heal-forfeited] failed: ${msg}`);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
