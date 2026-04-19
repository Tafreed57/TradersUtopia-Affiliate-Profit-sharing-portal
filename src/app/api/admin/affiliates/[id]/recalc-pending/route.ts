import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { runRecalcPending } from "@/lib/recalc-pending";

/**
 * POST /api/admin/affiliates/:id/recalc-pending
 *
 * Manual "re-run" of the unpaid-re-price. Normally fires automatically on
 * every rate change via PATCH; admin can invoke it directly to re-apply
 * classifications after a migration fixup or investigate drift.
 *
 * Scope matches runRecalcPending: re-prices all EARNED + PENDING AFFILIATE
 * splits using the affiliate's current initial/recurring rates. PAID +
 * VOIDED + FORFEITED are untouched.
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

  try {
    const result = await runRecalcPending(id, session.user.id);

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      updated: result.updated,
      teacherRowsAffected: result.teacherRowsAffected,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[recalc-pending] failed for affiliate ${id}: ${msg}`);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
