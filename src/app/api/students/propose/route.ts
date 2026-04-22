import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { adminUserWhereOr } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  studentId: z.string().min(1),
  proposedCut: z.number().min(0).max(100),
});

/**
 * POST /api/students/propose
 *
 * Teacher proposes a brand-new student relationship. Archived relationships
 * are restored through a separate request flow so admin can review the gap.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacherId = session.user.id;

  try {
    const body = await req.json();
    const { studentId, proposedCut } = schema.parse(body);

    if (studentId === teacherId) {
      return NextResponse.json(
        { error: "You cannot add yourself as a student" },
        { status: 400 }
      );
    }

    const proposer = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { canBeTeacher: true },
    });
    if (!proposer?.canBeTeacher && !session.user.isAdmin) {
      return NextResponse.json(
        { error: "You do not have permission to propose students" },
        { status: 403 }
      );
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, email: true },
    });
    if (!student) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existing = await prisma.teacherStudent.findUnique({
      where: { teacherId_studentId: { teacherId, studentId } },
    });

    if (existing) {
      if (existing.status === "ACTIVE") {
        return NextResponse.json(
          { error: "This user is already your student" },
          { status: 409 }
        );
      }
      if (existing.status === "PENDING") {
        return NextResponse.json(
          { error: "A proposal for this user is already pending admin review" },
          { status: 409 }
        );
      }
      if (existing.status === "DEACTIVATED") {
        return NextResponse.json(
          {
            error:
              "This student already has archived history under you. Use the previous students section to request a return so admin can review missed commissions first.",
            requiresRestoreRequest: true,
            relationshipId: existing.id,
          },
          { status: 409 }
        );
      }

      const updated = await prisma.teacherStudent.updateMany({
        where: {
          teacherId,
          studentId,
          status: "REJECTED",
        },
        data: {
          teacherCut: proposedCut,
          status: "PENDING",
          reviewedAt: null,
          reviewedById: null,
        },
      });
      if (updated.count !== 1) {
        return NextResponse.json(
          { error: "Relationship status changed; please try again" },
          { status: 409 }
        );
      }
    } else {
      await prisma.teacherStudent.create({
        data: {
          teacherId,
          studentId,
          depth: 1,
          teacherCut: proposedCut,
          status: "PENDING",
        },
      });
    }

    const adminWhere = adminUserWhereOr();
    if (adminWhere) {
      const adminUsers = await prisma.user.findMany({
        where: adminWhere,
        select: { id: true },
      });

      if (adminUsers.length > 0) {
        const teacherName = session.user.name || session.user.email || "A teacher";
        const studentLabel = student.name || student.email;
        await Promise.all(
          adminUsers.map((adminUser) =>
            createNotification({
              userId: adminUser.id,
              type: "STUDENT_PROPOSAL_RECEIVED",
              title: "New Student Proposal",
              body: `${teacherName} proposed adding ${studentLabel} as a student at ${proposedCut}% cut. Review in proposals.`,
              data: { teacherId, studentId },
            })
          )
        );
      }
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[propose-student] failed: ${msg}`);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
