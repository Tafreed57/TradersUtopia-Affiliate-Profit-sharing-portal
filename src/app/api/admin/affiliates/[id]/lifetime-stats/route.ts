import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import {
  AffiliatePortalDataError,
  getAffiliateLifetimeStatsData,
} from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/admin/affiliates/:id/lifetime-stats
 *
 * Admin-scoped lifetime stats for the managed affiliate. Mirrors the
 * affiliate-facing commissions header payload.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    return NextResponse.json(await getAffiliateLifetimeStatsData(id));
  } catch (error) {
    if (error instanceof AffiliatePortalDataError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error(`[admin-lifetime-stats] unexpected failure for ${id}:`, error);
    return NextResponse.json(
      { error: "Stats temporarily unavailable" },
      { status: 503 }
    );
  }
}
