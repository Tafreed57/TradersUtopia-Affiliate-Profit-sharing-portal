import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { TEACHER_CUT_WARN_THRESHOLD } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const pairSchema = z.object({
  teacherId: z.string().min(1),
  studentId: z.string().min(1),
  teacherCut: z.number().min(0).max(100).default(0),
});

/**
 * POST /api/admin/teacher-student
 *
 * Admin directly pairs a teacher with a student. Bypasses the self-proposal
 * flow — the relationship is ACTIVE immediately with createdVia=ADMIN_PAIR.
 *
 * Matches the approval flow's downstream effects (session 32):
 *   - Auto-cascade depth-2 relationships for the student's own active students
 *   - Retroactive TEACHER CommissionSplit creation for historical events
 *   - NEW_STUDENT_LINKED notifications to both parties (phrased neutrally —
 *     admin involvement is not disclosed in notification bodies)
 *
 * Resurrects PENDING/REJECTED/DEACTIVATED rows to ACTIVE. Returns 409 if the
 * relationship is already ACTIVE.
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

    const [teacher, student] = await Promise.all([
      prisma.user.findUnique({
        where: { id: teacherId },
        select: { id: true, name: true, email: true },
      }),
      prisma.user.findUnique({
        where: { id: studentId },
        select: { id: true, name: true, email: true },
      }),
    ]);

    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
    }
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const existing = await prisma.teacherStudent.findUnique({
      where: { teacherId_studentId: { teacherId, studentId } },
    });

    if (existing?.status === "ACTIVE") {
      return NextResponse.json(
        { error: "This user is already a student of this teacher" },
        { status: 409 }
      );
    }

    const now = new Date();
    let relationshipId: string;
    if (existing) {
      // Resurrect non-ACTIVE row atomically.
      const updated = await prisma.teacherStudent.updateMany({
        where: {
          id: existing.id,
          status: { in: ["PENDING", "REJECTED", "DEACTIVATED"] },
        },
        data: {
          teacherCut,
          status: "ACTIVE",
          createdVia: "ADMIN_PAIR",
          reviewedAt: now,
          reviewedById: session.user.id,
          depth: 1,
        },
      });
      if (updated.count !== 1) {
        return NextResponse.json(
          { error: "Relationship changed mid-request; try again" },
          { status: 409 }
        );
      }
      relationshipId = existing.id;
    } else {
      const created = await prisma.teacherStudent.create({
        data: {
          teacherId,
          studentId,
          depth: 1,
          teacherCut,
          status: "ACTIVE",
          createdVia: "ADMIN_PAIR",
          reviewedAt: now,
          reviewedById: session.user.id,
        },
      });
      relationshipId = created.id;
    }

    // Auto-cascade depth-2: one row per (teacher, studentOfStudent) at 0% cut.
    // skipDuplicates handles re-pair case where depth-2 rows already exist.
    // Filter out the teacher themselves — if the student already teaches the
    // teacher, the cascade would otherwise create teacherId→teacherId, a
    // self-relationship the schema's @@unique would not block.
    const studentsOfStudent = await prisma.teacherStudent.findMany({
      where: {
        teacherId: studentId,
        status: "ACTIVE",
        depth: 1,
        NOT: { studentId: teacherId },
      },
      select: { studentId: true },
    });

    if (studentsOfStudent.length > 0) {
      await prisma.teacherStudent.createMany({
        data: studentsOfStudent.map((s) => ({
          teacherId,
          studentId: s.studentId,
          depth: 2,
          teacherCut: 0,
          status: "ACTIVE" as const,
          createdVia: "ADMIN_PAIR" as const,
          reviewedAt: now,
          reviewedById: session.user.id,
        })),
        skipDuplicates: true,
      });
    }

    // Retroactive TEACHER splits for EARNED historical events. Per-event atomic
    // tx with P2002 catch matches session-32 backfill pattern — prevents
    // double-decrement under concurrent admin actions.
    if (teacherCut > 0) {
      const historicalEvents = await prisma.commissionEvent.findMany({
        where: {
          affiliateId: studentId,
          splits: { some: { role: "AFFILIATE", status: "EARNED" } },
        },
        select: {
          id: true,
          rewardfulCommissionId: true,
          fullAmountCad: true,
          ceoCutCad: true,
          splits: {
            where: { role: "TEACHER", recipientId: teacherId },
            select: { id: true },
          },
        },
      });

      for (const event of historicalEvents) {
        if (event.splits.length > 0) continue;
        const full = event.fullAmountCad.toNumber();
        const ceo = event.ceoCutCad.toNumber();
        const cut = Math.min(
          Number(((full * teacherCut) / 100).toFixed(2)),
          ceo
        );
        if (cut <= 0) continue;

        try {
          await prisma.$transaction([
            prisma.commissionSplit.create({
              data: {
                eventId: event.id,
                recipientId: teacherId,
                role: "TEACHER",
                depth: 1,
                cutPercent: teacherCut,
                cutCad: cut,
                status: "EARNED",
                forfeitedToCeo: false,
                forfeitureReason: null,
                idempotencyKey: event.rewardfulCommissionId
                  ? `${event.rewardfulCommissionId}:teacher:${teacherId}`
                  : `evt:${event.id}:teacher:${teacherId}`,
              },
            }),
            prisma.commissionEvent.update({
              where: { id: event.id },
              data: { ceoCutCad: Number((ceo - cut).toFixed(2)) },
            }),
          ]);
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            continue;
          }
          throw err;
        }
      }
    }

    // Allocation warning — non-blocking, returned to UI for banner.
    const [allTeachers, studentOwn] = await Promise.all([
      prisma.teacherStudent.findMany({
        where: { studentId, status: "ACTIVE" },
        select: { teacherCut: true },
      }),
      prisma.user.findUnique({
        where: { id: studentId },
        select: { commissionPercent: true },
      }),
    ]);
    const totalAllocated =
      (studentOwn?.commissionPercent.toNumber() ?? 0) +
      allTeachers.reduce((sum, t) => sum + t.teacherCut.toNumber(), 0);
    const allocationWarning = totalAllocated > TEACHER_CUT_WARN_THRESHOLD;

    // Notifications — phrased so neither party learns admin initiated the pair.
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
      relationshipId,
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
