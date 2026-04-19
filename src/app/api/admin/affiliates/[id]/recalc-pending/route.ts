import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { runRecalcPending } from "@/lib/recalc-pending";

/**
 * POST /api/admin/affiliates/:id/recalc-pending
 *
 * Manual "re-run" of the unpaid-re-price. Normally fires automatically on
 * every rate change via PATCH; admin can invoke it directly to re-apply
 * classifications after a migration fixup or investigate drift.
 *
 * Respects the affiliate's ratesLocked flag:
 *   unlocked: re-prices EARNED + PENDING at current rates (full path).
 *   locked:   PENDING only — EARNED stays frozen at original rate, so
 *             manual recalc cannot bypass the lock guarantee.
 * PAID + VOIDED + FORFEITED are always untouched regardless of mode.
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
    select: { ratesLocked: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await runRecalcPending(id, session.user.id, {
      pendingOnly: user.ratesLocked,
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      updated: result.updated,
      teacherRowsAffected: result.teacherRowsAffected,
      mode: user.ratesLocked ? "pending_only" : "full",
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
