import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  reviewNote: z.string().max(500).optional(),
});

/**
 * PATCH /api/admin/teacher-proposals/:id
 *
 * Admin approves or rejects a pending teacher-student proposal.
 *
 * On approve:
 *   - status → ACTIVE (atomic: updateMany guards on PENDING)
 *   - Depth-2 TeacherStudent rows auto-created for the student's own active students
 *   - Retroactive TEACHER CommissionSplit rows created for the student's EARNED
 *     historical events (capped at each event's current ceoCut)
 *   - Teacher + student notified
 *
 * On reject:
 *   - status → REJECTED (atomic)
 *   - Teacher notified
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

    const newStatus = action === "approve" ? "ACTIVE" : "REJECTED";

    const updated = await prisma.teacherStudent.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: newStatus,
        reviewedAt: new Date(),
        reviewedById: session.user.id,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json(
        { error: "Proposal was already processed by another request" },
        { status: 409 }
      );
    }

    if (action === "approve") {
      // Auto-create depth-2 TeacherStudent rows for the student's own active
      // students. Derivative — no separate proposal needed. teacherCut=0;
      // admin can adjust per student via rate tools.
      // Filter self-pair: if student already teaches the teacher, skip that pair.
      const studentsOfStudent = await prisma.teacherStudent.findMany({
        where: {
          teacherId: proposal.studentId,
          status: "ACTIVE",
          depth: 1,
          NOT: { studentId: proposal.teacherId },
        },
        select: { studentId: true },
      });

      if (studentsOfStudent.length > 0) {
        // Partition existing rows (resurrect) vs new (create) so previously
        // cascaded-then-deactivated depth-2 rows come back to life on re-approve.
        const sosIds = studentsOfStudent.map((s) => s.studentId);
        const existing = await prisma.teacherStudent.findMany({
          where: { teacherId: proposal.teacherId, studentId: { in: sosIds } },
          select: { studentId: true },
        });
        const existingIds = new Set(existing.map((r) => r.studentId));
        const toCreate = sosIds.filter((id) => !existingIds.has(id));
        const toResurrect = sosIds.filter((id) => existingIds.has(id));
        const now = new Date();

        if (toResurrect.length > 0) {
          await prisma.teacherStudent.updateMany({
            where: {
              teacherId: proposal.teacherId,
              studentId: { in: toResurrect },
            },
            data: {
              status: "ACTIVE",
              depth: 2,
              reviewedAt: now,
              reviewedById: session.user.id,
            },
          });
        }
        if (toCreate.length > 0) {
          await prisma.teacherStudent.createMany({
            data: toCreate.map((sid) => ({
              teacherId: proposal.teacherId,
              studentId: sid,
              depth: 2,
              teacherCut: 0,
              status: "ACTIVE" as const,
              reviewedAt: now,
              reviewedById: session.user.id,
            })),
          });
        }
      }

      // Retroactive TEACHER splits for the student's EARNED historical events.
      // These were processed before the relationship existed, so no teacher
      // split was created at the time. Teacher cut = fullAmount × % / 100,
      // capped at each event's current ceoCut.
      const historicalEvents = await prisma.commissionEvent.findMany({
        where: {
          affiliateId: proposal.studentId,
          splits: { some: { role: "AFFILIATE", status: "EARNED" } },
        },
        select: {
          id: true,
          rewardfulCommissionId: true,
          fullAmount: true,
          ceoCut: true,
          splits: {
            where: { role: "TEACHER", recipientId: proposal.teacherId },
            select: { id: true },
          },
        },
      });

      const teacherCutPct = proposal.teacherCut.toNumber();
      if (historicalEvents.length > 0 && teacherCutPct > 0) {
        const toProcess = historicalEvents
          .filter((e) => e.splits.length === 0)
          .map((e) => {
            const full = e.fullAmount.toNumber();
            const ceo = e.ceoCut.toNumber();
            const cut = Math.min(
              Number(((full * teacherCutPct) / 100).toFixed(2)),
              ceo
            );
            return { event: e, teacherCutAmount: cut };
          })
          .filter(({ teacherCutAmount }) => teacherCutAmount > 0);

        if (toProcess.length > 0) {
          // Array-form $transaction: safe with PgBouncer (no interactive tx).
          await prisma.$transaction([
            prisma.commissionSplit.createMany({
              data: toProcess.map(({ event, teacherCutAmount }) => ({
                eventId: event.id,
                recipientId: proposal.teacherId,
                role: "TEACHER" as const,
                depth: proposal.depth,
                cutPercent: proposal.teacherCut,
                cutAmount: teacherCutAmount,
                status: "EARNED" as const,
                forfeitedToCeo: false,
                forfeitureReason: null,
                idempotencyKey: event.rewardfulCommissionId
                  ? `${event.rewardfulCommissionId}:teacher:${proposal.teacherId}`
                  : `evt:${event.id}:teacher:${proposal.teacherId}`,
              })),
              skipDuplicates: true,
            }),
            ...toProcess.map(({ event, teacherCutAmount }) =>
              prisma.commissionEvent.update({
                where: { id: event.id },
                data: {
                  ceoCut: Number(
                    (event.ceoCut.toNumber() - teacherCutAmount).toFixed(2)
                  ),
                },
              })
            ),
          ]);
        }
      }
    }

    const studentLabel = proposal.student.name || proposal.student.email;
    const teacherLabel = proposal.teacher.name || proposal.teacher.email;
    if (action === "approve") {
      await createNotification({
        userId: proposal.teacherId,
        type: "STUDENT_PROPOSAL_APPROVED",
        title: "Student Proposal Approved",
        body: `${studentLabel} has been added as your student at ${proposal.teacherCut.toString()}% cut. Commissions will now flow.`,
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
    } else {
      await createNotification({
        userId: proposal.teacherId,
        type: "STUDENT_PROPOSAL_REJECTED",
        title: "Student Proposal Rejected",
        body: `Your proposal to add ${studentLabel} as a student was not approved.${reviewNote ? ` Note: ${reviewNote}` : ""}`,
        data: { studentId: proposal.studentId, reviewNote: reviewNote ?? null },
      });
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[teacher-proposals] patch failed for ${id}: ${msg}`);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
