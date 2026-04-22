import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { getRestoreGapPreview } from "@/lib/teacher-student-relationships";

/**
 * GET /api/admin/teacher-restore-requests
 *
 * Returns pending archived-student restore requests with the gap preview data
 * admin needs to approve none / some / all of the missed commissions.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requests = await prisma.teacherStudentRestoreRequest.findMany({
    where: { status: "PENDING" },
    include: {
      archive: {
        include: {
          teacher: { select: { id: true, name: true, email: true, image: true } },
          student: { select: { id: true, name: true, email: true, image: true } },
        },
      },
      requestedBy: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const previews = await Promise.all(
    requests.map((request) => getRestoreGapPreview(request.archiveId))
  );
  const previewByArchive = new Map(
    previews.map((preview) => [preview.archiveId, preview])
  );

  return NextResponse.json({
    data: requests.map((request) => ({
      id: request.id,
      createdAt: request.createdAt.toISOString(),
      requestNote: request.requestNote,
      requestedBy: request.requestedBy,
      teacher: request.archive.teacher,
      student: request.archive.student,
      preview: previewByArchive.get(request.archiveId),
    })),
  });
}
