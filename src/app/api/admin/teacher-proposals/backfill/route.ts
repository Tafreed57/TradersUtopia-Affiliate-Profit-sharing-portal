import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/teacher-proposals/backfill
 *
 * Retroactively creates TEACHER CommissionSplit rows for all ACTIVE depth-1
 * TeacherStudent relationships. Safe to run multiple times — idempotent via
 * the (eventId, recipientId) unique constraint on CommissionSplit.
 *
 * Use case: relationships approved before the retroactive-on-approval fix
 * never received teacher rows for events that pre-dated the relationship.
 *
 * Returns: { processed, created, relationships }
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only depth-1 relationships generate teacher rows. Depth-2 rows are
  // derivative — their splits come from new conversions processed after the
  // relationship is live.
  const relationships = await prisma.teacherStudent.findMany({
    where: { status: "ACTIVE", depth: 1 },
    select: { teacherId: true, studentId: true, teacherCut: true, depth: true },
  });

  let totalCreated = 0;
  let totalProcessed = 0;

  for (const rel of relationships) {
    const teacherCutPct = rel.teacherCut.toNumber();
    if (teacherCutPct === 0) continue;

    const historicalEvents = await prisma.commissionEvent.findMany({
      where: {
        affiliateId: rel.studentId,
        splits: { some: { role: "AFFILIATE", status: "EARNED" } },
      },
      select: {
        id: true,
        rewardfulCommissionId: true,
        fullAmountCad: true,
        ceoCutCad: true,
        splits: {
          where: { role: "TEACHER", recipientId: rel.teacherId },
          select: { id: true },
        },
      },
    });

    if (historicalEvents.length === 0) continue;
    totalProcessed += historicalEvents.length;

    const toProcess = historicalEvents
      .filter((e) => e.splits.length === 0)
      .map((e) => {
        const full = e.fullAmountCad.toNumber();
        const ceo = e.ceoCutCad.toNumber();
        const cut = Math.min(
          Number(((full * teacherCutPct) / 100).toFixed(2)),
          ceo
        );
        return { event: e, teacherCutCad: cut };
      })
      .filter(({ teacherCutCad }) => teacherCutCad > 0);

    if (toProcess.length === 0) continue;

    await prisma.$transaction([
      prisma.commissionSplit.createMany({
        data: toProcess.map(({ event, teacherCutCad }) => ({
          eventId: event.id,
          recipientId: rel.teacherId,
          role: "TEACHER" as const,
          depth: rel.depth,
          cutPercent: rel.teacherCut,
          cutCad: teacherCutCad,
          status: "EARNED" as const,
          forfeitedToCeo: false,
          forfeitureReason: null,
          idempotencyKey: event.rewardfulCommissionId
            ? `${event.rewardfulCommissionId}:teacher:${rel.teacherId}`
            : `evt:${event.id}:teacher:${rel.teacherId}`,
        })),
        skipDuplicates: true,
      }),
      ...toProcess.map(({ event, teacherCutCad }) =>
        prisma.commissionEvent.update({
          where: { id: event.id },
          data: {
            ceoCutCad: Number(
              (event.ceoCutCad.toNumber() - teacherCutCad).toFixed(2)
            ),
          },
        })
      ),
    ]);

    totalCreated += toProcess.length;
  }

  return NextResponse.json({
    ok: true,
    relationships: relationships.length,
    processed: totalProcessed,
    created: totalCreated,
  });
}
