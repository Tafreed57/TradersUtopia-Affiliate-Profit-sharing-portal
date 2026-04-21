import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { getAffiliateCommissionsData } from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/admin/affiliates/:id/commissions
 *
 * Admin-scoped commission history for the managed affiliate. Mirrors the
 * affiliate-facing /api/commissions payload and filters.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const url = req.nextUrl;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? "20"))
  );

  return NextResponse.json(
    await getAffiliateCommissionsData(id, {
      page,
      limit,
      status: url.searchParams.get("status"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    })
  );
}
