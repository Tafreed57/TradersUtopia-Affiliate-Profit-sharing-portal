import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { runRecalcPending } from "@/lib/recalc-pending";

/**
 * POST /api/admin/affiliates/:id/recalc-pending
 *
 * Recalculates all PENDING commissions with forfeitureReason='rate_not_set'
 * using the affiliate's CURRENT commissionPercent. Re-checks attendance per
 * commission. Logic lives in src/lib/recalc-pending.ts (shared with the
 * PATCH route's auto-trigger on first rate set).
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
    if (result.kind === "rate_zero") {
      return NextResponse.json(
        {
          error:
            "Affiliate rate is still 0. Set a rate before running recalculation.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      updated: result.updated,
      teacherRowsAffected: result.teacherRowsAffected,
      newRate: result.newRate,
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
