import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { reviewTeacherStudentRestoreRequest } from "@/lib/teacher-student-relationships";

const schema = z
  .object({
    action: z.literal("reject"),
    reviewNote: z.string().max(500).optional(),
  })
  .or(
    z.object({
      action: z.literal("approve"),
      reviewNote: z.string().max(500).optional(),
      backfillMode: z.enum(["NONE", "ALL", "CUSTOM"]),
      selectedEventIds: z.array(z.string()).optional(),
    })
  );

/**
 * PATCH /api/admin/teacher-restore-requests/:id
 *
 * Admin reviews a restore request and can grant none, some, or all of the
 * missed archived-gap commissions during approval.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = schema.parse(await req.json());
    const request = await prisma.teacherStudentRestoreRequest.findUnique({
      where: { id },
      include: {
        archive: {
          include: {
            teacher: { select: { id: true, name: true, email: true } },
            student: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!request) {
      return NextResponse.json(
        { error: "Restore request not found" },
        { status: 404 }
      );
    }

    const result = await reviewTeacherStudentRestoreRequest({
      requestId: id,
      reviewedById: session.user.id,
      action: body.action,
      reviewNote: body.reviewNote ?? null,
      backfillMode:
        body.action === "approve" ? body.backfillMode : undefined,
      selectedEventIds:
        body.action === "approve" ? body.selectedEventIds ?? [] : undefined,
    });

    const studentLabel =
      request.archive.student.name || request.archive.student.email;
    const teacherLabel =
      request.archive.teacher.name || request.archive.teacher.email;

    if (body.action === "reject") {
      await createNotification({
        userId: request.archive.teacher.id,
        type: "STUDENT_PROPOSAL_REJECTED",
        title: "Student return request rejected",
        body: `Your request to bring ${studentLabel} back was not approved.${body.reviewNote ? ` Note: ${body.reviewNote}` : ""}`,
        data: { archiveId: request.archiveId, href: "/students" },
      });
    } else {
      await createNotification({
        userId: request.archive.teacher.id,
        type: "STUDENT_PROPOSAL_APPROVED",
        title: "Student return approved",
        body:
          result.grantedCount > 0
            ? `${studentLabel} is active under you again. ${result.grantedCount} archived-gap commission${result.grantedCount === 1 ? "" : "s"} were granted back into your totals.`
            : `${studentLabel} is active under you again. No archived-gap commissions were granted on this restore.`,
        data: { studentId: request.archive.student.id, href: "/students" },
      });
      await createNotification({
        userId: request.archive.student.id,
        type: "NEW_STUDENT_LINKED",
        title: "Teacher link updated",
        body: `${teacherLabel} is listed as one of your teachers again.`,
        data: { teacherId: request.archive.teacher.id, href: "/students" },
      });
    }

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
      console.error(`[teacher-restore-request:${id}] failed: ${message}`);
    }
    return NextResponse.json(
      { error: status === 500 ? "Failed to review restore request" : message },
      { status }
    );
  }
}
