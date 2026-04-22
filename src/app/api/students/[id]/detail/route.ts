import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import {
  AffiliatePortalDataError,
  getTeacherStudentDetailData,
} from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";

/**
 * GET /api/students/:id/detail
 *
 * Returns the teacher's TEACHER CommissionSplit rows for a student plus the
 * student's attendance records. Auth requires an active teacher relationship.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: studentId } = await params;
  const relationshipId = req.nextUrl.searchParams.get("relationshipId") ?? undefined;
  const relationshipSequenceParam =
    req.nextUrl.searchParams.get("relationshipSequence");
  const relationshipSequence = relationshipSequenceParam
    ? Number(relationshipSequenceParam)
    : undefined;

  try {
    return NextResponse.json(
      await getTeacherStudentDetailData(session.user.id, studentId, {
        relationshipId,
        relationshipSequence:
          relationshipSequence !== undefined && Number.isFinite(relationshipSequence)
            ? relationshipSequence
            : undefined,
      })
    );
  } catch (error) {
    if (error instanceof AffiliatePortalDataError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error(
      `[student-detail] unexpected failure for viewer=${session.user.id} student=${studentId}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch student detail" },
      { status: 500 }
    );
  }
}
