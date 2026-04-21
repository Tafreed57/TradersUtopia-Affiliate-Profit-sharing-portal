import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { getAffiliateAttendanceData } from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/admin/affiliates/:id/attendance
 *
 * Admin-scoped attendance history for the managed affiliate. Mirrors the
 * affiliate-facing /api/attendance GET payload.
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
    Math.max(1, Number(url.searchParams.get("limit") ?? "30"))
  );

  return NextResponse.json(
    await getAffiliateAttendanceData(id, {
      page,
      limit,
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    })
  );
}
