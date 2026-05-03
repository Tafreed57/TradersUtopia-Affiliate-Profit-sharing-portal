import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { restoreTeacherStudentDirect } from "@/lib/teacher-student-relationships";

const schema = z.object({
  archiveId: z.string().min(1),
  reviewNote: z.string().max(500).optional(),
  backfillMode: z.enum(["NONE", "ALL", "CUSTOM"]),
  selectedEventIds: z.array(z.string()).optional(),
});

/**
 * POST /api/admin/teacher-student/restore
 *
 * Admin directly restores an archived relationship from the managed affiliate
 * workspace and chooses how much of the archived-gap to grant back.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = schema.parse(await req.json());
    const archive = await prisma.teacherStudentArchive.findUnique({
      where: { id: body.archiveId },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        student: { select: { id: true, name: true, email: true } },
      },
    });

    if (!archive) {
      return NextResponse.json(
        { error: "Archived relationship not found" },
        { status: 404 }
      );
    }

    const result = await restoreTeacherStudentDirect({
      archiveId: body.archiveId,
      reviewedById: session.user.id,
      reviewNote: body.reviewNote ?? null,
      backfillMode: body.backfillMode,
      selectedEventIds: body.selectedEventIds ?? [],
    });

    const studentLabel = archive.student.name || archive.student.email;
    const teacherLabel = archive.teacher.name || archive.teacher.email;
    await createNotification({
      userId: archive.teacher.id,
      type: "STUDENT_PROPOSAL_APPROVED",
      title: "Student return approved",
      body:
        result.grantedCount > 0
          ? `${studentLabel} is active under you again. ${result.grantedCount} archived-gap commission${result.grantedCount === 1 ? "" : "s"} were granted back into your totals.`
          : `${studentLabel} is active under you again. No archived-gap commissions were granted on this restore.`,
      data: { studentId: archive.student.id, href: "/students" },
    });
    await createNotification({
      userId: archive.student.id,
      type: "NEW_STUDENT_LINKED",
      title: "Teacher link updated",
      body: `${teacherLabel} is listed as one of your teachers again.`,
      data: { teacherId: archive.teacher.id, href: "/students" },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    const status =
      message.includes("not found")
        ? 404
        : message.includes("already")
        ? 409
        : 500;
    if (status === 500) {
      console.error(`[admin-direct-restore] failed: ${message}`);
    }
    return NextResponse.json(
      { error: status === 500 ? "Failed to restore student" : message },
      { status }
    );
  }
}
