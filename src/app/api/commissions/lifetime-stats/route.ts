import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import {
  AffiliatePortalDataError,
  getAffiliateLifetimeStatsData,
} from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/commissions/lifetime-stats
 *
 * Authenticated user's all-time performance — visitors, leads, conversions —
 * augmented with local payout totals based on their own AFFILIATE splits.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(
      await getAffiliateLifetimeStatsData(session.user.id)
    );
  } catch (error) {
    if (error instanceof AffiliatePortalDataError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error(`[lifetime-stats] unexpected failure for ${session.user.id}:`, error);
    return NextResponse.json(
      { error: "Stats temporarily unavailable" },
      { status: 503 }
    );
  }
}
