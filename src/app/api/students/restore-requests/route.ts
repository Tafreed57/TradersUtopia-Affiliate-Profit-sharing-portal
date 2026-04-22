import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { adminUserWhereOr } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { requestTeacherStudentRestore } from "@/lib/teacher-student-relationships";

const schema = z.object({
  archiveId: z.string().min(1),
  requestNote: z.string().max(500).optional(),
});

/**
 * POST /api/students/restore-requests
 *
 * Teacher asks admin to restore an archived direct student relationship.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { archiveId, requestNote } = schema.parse(body);

    const request = await requestTeacherStudentRestore({
      archiveId,
      requestedById: session.user.id,
      requestNote: requestNote ?? null,
    });

    const archive = await prisma.teacherStudentArchive.findUnique({
      where: { id: archiveId },
      include: {
        student: { select: { name: true, email: true } },
      },
    });

    const adminWhere = adminUserWhereOr();
    if (adminWhere && archive) {
      const adminUsers = await prisma.user.findMany({
        where: adminWhere,
        select: { id: true },
      });

      if (adminUsers.length > 0) {
        const teacherName = session.user.name || session.user.email || "A teacher";
        const studentLabel = archive.student.name || archive.student.email;
        await Promise.all(
          adminUsers.map((adminUser) =>
            createNotification({
              userId: adminUser.id,
              type: "STUDENT_PROPOSAL_RECEIVED",
              title: "Student return request",
              body: `${teacherName} asked to restore ${studentLabel}. Review the archived gap before approving.`,
              data: { archiveId, restoreRequestId: request.id, href: "/admin/proposals" },
            })
          )
        );
      }
    }

    return NextResponse.json({ ok: true, requestId: request.id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    const status =
      message.includes("not found") || message.includes("Only the archived teacher")
        ? 404
        : message.includes("already") || message.includes("active")
        ? 409
        : 500;

    if (status === 500) {
      console.error(`[restore-request] failed: ${message}`);
    }

    return NextResponse.json(
      { error: status === 500 ? "Failed to create restore request" : message },
      { status }
    );
  }
}
