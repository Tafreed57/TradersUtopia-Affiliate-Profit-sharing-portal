import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { TEACHER_CUT_WARN_THRESHOLD } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { activateTeacherStudentRelationship } from "@/lib/teacher-student-relationships";

const pairSchema = z.object({
  teacherId: z.string().min(1),
  studentId: z.string().min(1),
  teacherCut: z.number().min(0).max(100).default(0),
});

/**
 * POST /api/admin/teacher-student
 *
 * Admin directly pairs a teacher with a student when this is a brand-new
 * link or a never-approved proposal. Archived links must be restored through
 * the dedicated review flow so missed-gap commissions can be reviewed first.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { teacherId, studentId, teacherCut } = pairSchema.parse(body);

    if (teacherId === studentId) {
      return NextResponse.json(
        { error: "Cannot pair a user with themselves" },
        { status: 400 }
      );
    }

    const [teacher, student, existing] = await Promise.all([
      prisma.user.findUnique({
        where: { id: teacherId },
        select: { id: true, name: true, email: true },
      }),
      prisma.user.findUnique({
        where: { id: studentId },
        select: { id: true, name: true, email: true },
      }),
      prisma.teacherStudent.findUnique({
        where: { teacherId_studentId: { teacherId, studentId } },
        select: { id: true, status: true },
      }),
    ]);

    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
    }
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (existing?.status === "ACTIVE") {
      return NextResponse.json(
        { error: "This user is already a student of this teacher" },
        { status: 409 }
      );
    }

    if (existing?.status === "DEACTIVATED") {
      return NextResponse.json(
        {
          error:
            "This student already has archived history under this teacher. Restore it from the previous students section so missed commissions can be reviewed first.",
          requiresRestoreReview: true,
          relationshipId: existing.id,
        },
        { status: 409 }
      );
    }

    const activation = await activateTeacherStudentRelationship({
      teacherId,
      studentId,
      teacherCut,
      actorId: session.user.id,
      origin: "ADMIN_PAIR",
      historicalBackfill: "UNPAID_ONLY",
    });

    const [allTeachers, studentOwn] = await Promise.all([
      prisma.teacherStudent.findMany({
        where: { studentId, status: "ACTIVE" },
        select: { teacherCut: true },
      }),
      prisma.user.findUnique({
        where: { id: studentId },
        select: {
          initialCommissionPercent: true,
          recurringCommissionPercent: true,
        },
      }),
    ]);
    const studentMaxRate = Math.max(
      studentOwn?.initialCommissionPercent.toNumber() ?? 0,
      studentOwn?.recurringCommissionPercent.toNumber() ?? 0
    );
    const totalAllocated =
      studentMaxRate +
      allTeachers.reduce((sum, currentTeacher) => {
        return sum + currentTeacher.teacherCut.toNumber();
      }, 0);
    const allocationWarning = totalAllocated > TEACHER_CUT_WARN_THRESHOLD;

    const teacherLabel = teacher.name || teacher.email;
    const studentLabel = student.name || student.email;
    await createNotification({
      userId: teacherId,
      type: "NEW_STUDENT_LINKED",
      title: "New student linked",
      body: `${studentLabel} is now your student.`,
      data: { studentId, href: "/students" },
    });
    await createNotification({
      userId: studentId,
      type: "NEW_STUDENT_LINKED",
      title: "You've been added to a teacher",
      body: `${teacherLabel} is now earning a cut from your commissions.`,
      data: { teacherId, href: "/students" },
    });

    return NextResponse.json({
      ok: true,
      relationshipId: activation.relationship.id,
      historicalBackfillCreated: activation.historicalBackfillCreated,
      allocationWarning,
      totalAllocated,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin-pair] failed: ${msg}`);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
