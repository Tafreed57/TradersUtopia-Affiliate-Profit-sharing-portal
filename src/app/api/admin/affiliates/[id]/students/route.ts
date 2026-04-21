import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import {
  AffiliatePortalDataError,
  getTeacherStudentsData,
} from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/admin/affiliates/:id/students
 *
 * Admin-scoped teacher dashboard data for the managed affiliate.
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
    return NextResponse.json(await getTeacherStudentsData(id));
  } catch (error) {
    if (error instanceof AffiliatePortalDataError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error(`[admin-students] unexpected failure for ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to fetch students" },
      { status: 500 }
    );
  }
}
