import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/admin/teacher-student/:id
 *
 * Admin unpairs a teacher-student relationship — soft-delete via
 * status=DEACTIVATED. Existing CommissionSplit rows are preserved (they were
 * earned, period). No new splits flow going forward.
 *
 * Depth-2 cascade: if the removed relationship is depth=1, any depth-2 row
 * this teacher has through this student's tree is ALSO deactivated — UNLESS
 * another active depth-1 bridge still derives it. Example: Alice teaches
 * Bob + Dave; Bob + Dave both teach Carol; Alice→Carol depth-2 exists. If
 * admin removes Alice→Bob, Alice→Carol STAYS (still derivable via Dave). If
 * admin then also removes Alice→Dave, Alice→Carol deactivates.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const relationship = await prisma.teacherStudent.findUnique({
    where: { id },
    select: {
      id: true,
      teacherId: true,
      studentId: true,
      depth: true,
      status: true,
    },
  });

  if (!relationship) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (relationship.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Relationship is not active" },
      { status: 409 }
    );
  }

  const now = new Date();
  let cascaded = 0;

  if (relationship.depth === 1) {
    // Candidates: student's own active depth-1 students.
    const studentsOfStudent = await prisma.teacherStudent.findMany({
      where: {
        teacherId: relationship.studentId,
        status: "ACTIVE",
        depth: 1,
      },
      select: { studentId: true },
    });
    const candidateIds = studentsOfStudent.map((s) => s.studentId);

    if (candidateIds.length > 0) {
      // The teacher's OTHER active depth-1 students (excluding the one being
      // removed) are alternative bridges. For each candidate depth-2 target,
      // if ANY of those alt-bridges teach the candidate at depth 1, the
      // depth-2 row should NOT be cascaded.
      const otherBridges = await prisma.teacherStudent.findMany({
        where: {
          teacherId: relationship.teacherId,
          status: "ACTIVE",
          depth: 1,
          NOT: { id: relationship.id },
        },
        select: { studentId: true },
      });
      const otherBridgeIds = otherBridges.map((b) => b.studentId);

      const survivingBridges = otherBridgeIds.length
        ? await prisma.teacherStudent.findMany({
            where: {
              teacherId: { in: otherBridgeIds },
              studentId: { in: candidateIds },
              status: "ACTIVE",
              depth: 1,
            },
            select: { studentId: true },
          })
        : [];
      const survivingIds = new Set(survivingBridges.map((b) => b.studentId));

      const toDeactivateIds = candidateIds.filter(
        (cid) => !survivingIds.has(cid)
      );

      if (toDeactivateIds.length > 0) {
        const cascadeRes = await prisma.teacherStudent.updateMany({
          where: {
            teacherId: relationship.teacherId,
            studentId: { in: toDeactivateIds },
            status: "ACTIVE",
            depth: 2,
          },
          data: {
            status: "DEACTIVATED",
            reviewedAt: now,
            reviewedById: session.user.id,
          },
        });
        cascaded = cascadeRes.count;
      }
    }
  }

  const res = await prisma.teacherStudent.updateMany({
    where: { id, status: "ACTIVE" },
    data: {
      status: "DEACTIVATED",
      reviewedAt: now,
      reviewedById: session.user.id,
    },
  });

  if (res.count === 0) {
    return NextResponse.json(
      { error: "Relationship changed mid-request; try again" },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, cascaded });
}
