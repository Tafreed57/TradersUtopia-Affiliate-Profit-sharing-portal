import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import {
  AffiliatePortalDataError,
  getTeacherStudentDetailData,
} from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/admin/affiliates/:id/students/:studentId/detail
 *
 * Admin drill-down into how the managed affiliate sees one student.
 */
export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; studentId: string }>;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, studentId } = await params;

  try {
    return NextResponse.json(await getTeacherStudentDetailData(id, studentId));
  } catch (error) {
    if (error instanceof AffiliatePortalDataError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error(
      `[admin-student-detail] unexpected failure for teacher=${id} student=${studentId}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch student detail" },
      { status: 500 }
    );
  }
}
