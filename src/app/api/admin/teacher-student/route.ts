import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import {
  findOrCreatePortalUserForUpstreamAffiliate,
  UpstreamAffiliateLinkError,
} from "@/lib/admin-upstream-affiliate-link";
import { syncAffiliateCommissionCatalog } from "@/lib/affiliate-sync-service";
import { authOptions } from "@/lib/auth-options";
import { TEACHER_CUT_WARN_THRESHOLD } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { activateTeacherStudentRelationship } from "@/lib/teacher-student-relationships";

export const maxDuration = 300;

const pairSchema = z.object({
  teacherId: z.string().min(1),
  studentId: z.string().min(1).optional(),
  upstreamAffiliateId: z.string().min(1).optional(),
  teacherCut: z.number().min(0).max(100).default(0),
}).refine((value) => value.studentId || value.upstreamAffiliateId, {
  message: "Student is required",
  path: ["studentId"],
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
    const parsed = pairSchema.parse(body);
    const { teacherId, teacherCut, upstreamAffiliateId } = parsed;
    let { studentId } = parsed;

    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { id: true, name: true, email: true },
    });
    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
    }

    if (!studentId && upstreamAffiliateId) {
      const linkedUser = await findOrCreatePortalUserForUpstreamAffiliate(
        upstreamAffiliateId
      );
      studentId = linkedUser.id;
    }

    if (!studentId) {
      return NextResponse.json({ error: "Student is required" }, { status: 400 });
    }

    if (teacherId === studentId) {
      return NextResponse.json(
        { error: "Cannot pair a user with themselves" },
        { status: 400 }
      );
    }

    const [student, existing] = await Promise.all([
      prisma.user.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          name: true,
          email: true,
          rewardfulAffiliateId: true,
        },
      }),
      prisma.teacherStudent.findUnique({
        where: { teacherId_studentId: { teacherId, studentId } },
        select: { id: true, status: true },
      }),
    ]);

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

    let historySync:
      | { status: "SKIPPED"; reason: "NO_LINKED_COMMISSION_ACCOUNT" }
      | ({
          status: "COMPLETED";
        } & Awaited<ReturnType<typeof syncAffiliateCommissionCatalog>>)
      | { status: "FAILED"; error: string } = {
      status: "SKIPPED",
      reason: "NO_LINKED_COMMISSION_ACCOUNT",
    };

    if (student.rewardfulAffiliateId) {
      try {
        const syncResult = await syncAffiliateCommissionCatalog({
          affiliateId: student.id,
          rewardfulAffiliateId: student.rewardfulAffiliateId,
        });
        historySync = { status: "COMPLETED", ...syncResult };
      } catch (error) {
        console.error(
          `[admin-pair] commission history sync failed for student ${student.id}:`,
          error
        );
        historySync = {
          status: "FAILED",
          error:
            "The relationship was created, but commission history sync failed. Retry syncing this affiliate from the admin panel.",
        };
      }
    }

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
      title: "Teacher link updated",
      body: `${teacherLabel} is now listed as one of your teachers.`,
      data: { teacherId, href: "/students" },
    });

    return NextResponse.json({
      ok: true,
      relationshipId: activation.relationship.id,
      historicalBackfillCreated: activation.historicalBackfillCreated,
      historySync,
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
    if (err instanceof UpstreamAffiliateLinkError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin-pair] failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
