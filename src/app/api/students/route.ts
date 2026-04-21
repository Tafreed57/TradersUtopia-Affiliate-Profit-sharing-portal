import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import {
  AffiliatePortalDataError,
  getTeacherStudentsData,
} from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/students
 *
 * Teacher-facing student tree:
 *   - direct students (depth 1)
 *   - each direct student's own students nested underneath (depth 2)
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getTeacherStudentsData(session.user.id));
  } catch (error) {
    if (error instanceof AffiliatePortalDataError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error(`[students] unexpected failure for ${session.user.id}:`, error);
    return NextResponse.json(
      { error: "Failed to fetch students" },
      { status: 500 }
    );
  }
}
