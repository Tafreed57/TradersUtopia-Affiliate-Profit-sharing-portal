import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { getAffiliateCommissionsData } from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/commissions
 *
 * Returns paginated commission history for the authenticated user — each row
 * is an AFFILIATE CommissionSplit (what the user earned per conversion).
 *
 * Query params: page, limit, status, from, to
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? "20"))
  );
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  return NextResponse.json(
    await getAffiliateCommissionsData(session.user.id, {
      page,
      limit,
      status,
      from,
      to,
    })
  );
}
