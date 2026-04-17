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
 *   - Depth-2 rows auto-created for the student's own active students
 *   - Teacher notified
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

    // Read proposal for notification data (before atomic write)
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

    // Atomic write: guard on PENDING so concurrent requests can't double-process
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

    // On approve: auto-create depth-2 rows for the student's own active students.
    // These are derivative relationships — no separate proposal needed.
    // teacherCut defaults to 0 (admin can adjust per student via rate tools).
    if (action === "approve") {
      const studentsOfStudent = await prisma.teacherStudent.findMany({
        where: { teacherId: proposal.studentId, status: "ACTIVE", depth: 1 },
        select: { studentId: true },
      });

      if (studentsOfStudent.length > 0) {
        await prisma.teacherStudent.createMany({
          data: studentsOfStudent.map((s) => ({
            teacherId: proposal.teacherId,
            studentId: s.studentId,
            depth: 2,
            teacherCut: 0,
            status: "ACTIVE",
            reviewedAt: new Date(),
            reviewedById: session.user.id,
          })),
          skipDuplicates: true,
        });
      }

      // Retroactively create teacher Commission rows for the student's existing
      // EARNED commissions. These were processed before the relationship existed,
      // so no teacher rows were created at the time.
      // Teacher cut = fullAmountCad × (teacherCut% / 100), capped at ceoCutCad.
      const historicalCommissions = await prisma.commission.findMany({
        where: { affiliateId: proposal.studentId, teacherId: null, status: "EARNED" },
        select: {
          id: true,
          rewardfulCommissionId: true,
          rewardfulReferralId: true,
          fullAmountCad: true,
          ceoCutCad: true,
          forfeitedToCeo: true,
          forfeitureReason: true,
          conversionDate: true,
        },
      });

      if (historicalCommissions.length > 0) {
        const teacherCutPct = proposal.teacherCut.toNumber();

        // Pre-check existing keys so a retry doesn't double-reduce CEO cuts.
        const candidateKeys = historicalCommissions.map(
          (c) => `${c.id}:teacher:${proposal.teacherId}`
        );
        const existingKeys = new Set(
          (
            await prisma.commission.findMany({
              where: { idempotencyKey: { in: candidateKeys } },
              select: { idempotencyKey: true },
            })
          ).map((r) => r.idempotencyKey)
        );

        const toProcess = historicalCommissions
          .filter((c) => !existingKeys.has(`${c.id}:teacher:${proposal.teacherId}`))
          .map((c) => {
            const full = c.fullAmountCad.toNumber();
            const ceo = c.ceoCutCad.toNumber();
            const cut = Math.min(Number((full * teacherCutPct / 100).toFixed(2)), ceo);
            return { commission: c, teacherCutCad: cut };
          })
          .filter(({ teacherCutCad }) => teacherCutCad > 0);

        if (toProcess.length > 0) {
          // Array-form $transaction: safe with PgBouncer (no interactive tx).
          await prisma.$transaction([
            prisma.commission.createMany({
              data: toProcess.map(({ commission, teacherCutCad }) => ({
                affiliateId: proposal.studentId,
                teacherId: proposal.teacherId,
                rewardfulCommissionId: commission.rewardfulCommissionId,
                rewardfulReferralId: commission.rewardfulReferralId,
                idempotencyKey: `${commission.id}:teacher:${proposal.teacherId}`,
                fullAmountCad: commission.fullAmountCad,
                affiliateCutPercent: 0,
                affiliateCutCad: 0,
                teacherCutPercent: proposal.teacherCut,
                teacherCutCad,
                ceoCutCad: 0,
                status: "EARNED",
                forfeitedToCeo: commission.forfeitedToCeo,
                forfeitureReason: commission.forfeitureReason,
                conversionDate: commission.conversionDate,
              })),
              skipDuplicates: true,
            }),
            ...toProcess.map(({ commission, teacherCutCad }) =>
              prisma.commission.update({
                where: { id: commission.id },
                data: {
                  ceoCutCad: Number(
                    (commission.ceoCutCad.toNumber() - teacherCutCad).toFixed(2)
                  ),
                },
              })
            ),
          ]);
        }
      }
    }

    // Notify the teacher
    const studentLabel = proposal.student.name || proposal.student.email;
    if (action === "approve") {
      await createNotification({
        userId: proposal.teacherId,
        type: "STUDENT_PROPOSAL_APPROVED",
        title: "Student Proposal Approved",
        body: `${studentLabel} has been added as your student at ${proposal.teacherCut.toString()}% cut. Commissions will now flow.`,
        data: { studentId: proposal.studentId },
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
