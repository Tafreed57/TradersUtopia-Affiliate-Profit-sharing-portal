import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { activateTeacherStudentRelationship } from "@/lib/teacher-student-relationships";

export const maxDuration = 300;

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  reviewNote: z.string().max(500).optional(),
});

/**
 * PATCH /api/admin/teacher-proposals/:id
 *
 * Admin approves or rejects a pending teacher-student proposal.
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
    const body = await req.json();
    const { action, reviewNote } = schema.parse(body);

    const proposal = await prisma.teacherStudent.findUnique({
      where: { id },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        student: { select: { id: true, name: true, email: true } },
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    if (proposal.status !== "PENDING") {
      return NextResponse.json(
        { error: `Proposal is already ${proposal.status.toLowerCase()}` },
        { status: 409 }
      );
    }

    if (action === "reject") {
      await prisma.teacherStudent.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewedById: session.user.id,
        },
      });

      await createNotification({
        userId: proposal.teacherId,
        type: "STUDENT_PROPOSAL_REJECTED",
        title: "Student Proposal Rejected",
        body: `Your proposal to add ${proposal.student.name || proposal.student.email} as a student was not approved.${reviewNote ? ` Note: ${reviewNote}` : ""}`,
        data: { studentId: proposal.studentId, reviewNote: reviewNote ?? null },
      });

      return NextResponse.json({ ok: true, status: "REJECTED" });
    }

    const activation = await activateTeacherStudentRelationship({
      teacherId: proposal.teacherId,
      studentId: proposal.studentId,
      teacherCut: proposal.teacherCut.toNumber(),
      actorId: session.user.id,
      origin: proposal.createdVia,
      historicalBackfill: "UNPAID_ONLY",
    });

    const studentLabel = proposal.student.name || proposal.student.email;
    const teacherLabel = proposal.teacher.name || proposal.teacher.email;

    await createNotification({
      userId: proposal.teacherId,
      type: "STUDENT_PROPOSAL_APPROVED",
      title: "Student Proposal Approved",
      body: `${studentLabel} has been added as your student at ${proposal.teacherCut.toString()}% cut.${activation.historicalBackfillCreated > 0 ? ` ${activation.historicalBackfillCreated} unpaid commission${activation.historicalBackfillCreated === 1 ? "" : "s"} were also brought under your history.` : ""}`,
      data: { studentId: proposal.studentId, href: "/students" },
    });
    await createNotification({
      userId: proposal.studentId,
      type: "NEW_STUDENT_LINKED",
      title: "You've been added to a teacher",
      body: `${teacherLabel} is now earning a cut from your commissions.`,
      data: { teacherId: proposal.teacherId, href: "/students" },
    });
    await createNotification({
      userId: proposal.teacherId,
      type: "NEW_STUDENT_LINKED",
      title: "New student linked",
      body: `${studentLabel} is now your student.`,
      data: { studentId: proposal.studentId, href: "/students" },
    });

    return NextResponse.json({ ok: true, status: "ACTIVE" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error(`[teacher-proposals] patch failed for ${id}:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
