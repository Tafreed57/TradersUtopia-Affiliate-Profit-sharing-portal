import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { getRestoreGapPreview } from "@/lib/teacher-student-relationships";

/**
 * GET /api/admin/teacher-student/restore-preview?archiveId=...
 *
 * Admin preview for restoring an archived student directly from the managed
 * workspace without waiting for a teacher request.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const archiveId = req.nextUrl.searchParams.get("archiveId");
  if (!archiveId) {
    return NextResponse.json({ error: "archiveId is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getRestoreGapPreview(archiveId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) {
      console.error(`[restore-preview] failed for ${archiveId}: ${message}`);
    }
    return NextResponse.json(
      { error: status === 500 ? "Failed to load restore preview" : message },
      { status }
    );
  }
}
