import { Prisma } from "@prisma/client";
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
        fullAmount: true,
        ceoCut: true,
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
        const full = e.fullAmount.toNumber();
        const ceo = e.ceoCut.toNumber();
        const cut = Math.min(
          Number(((full * teacherCutPct) / 100).toFixed(2)),
          ceo
        );
        return { event: e, teacherCutAmount: cut };
      })
      .filter(({ teacherCutAmount }) => teacherCutAmount > 0);

    if (toProcess.length === 0) continue;

    // Per-event atomic write: `create` + event.ceoCut decrement in one tx,
    // then catch P2002 on the split's (eventId, recipientId) unique so a
    // concurrent backfill can't double-decrement ceoCut. skipDuplicates
    // on createMany wouldn't help here because the event update doesn't know
    // which inserts were skipped.
    for (const { event, teacherCutAmount } of toProcess) {
      try {
        await prisma.$transaction([
          prisma.commissionSplit.create({
            data: {
              eventId: event.id,
              recipientId: rel.teacherId,
              role: "TEACHER",
              depth: rel.depth,
              cutPercent: rel.teacherCut,
              cutAmount: teacherCutAmount,
              status: "EARNED",
              forfeitedToCeo: false,
              forfeitureReason: null,
              idempotencyKey: event.rewardfulCommissionId
                ? `${event.rewardfulCommissionId}:teacher:${rel.teacherId}`
                : `evt:${event.id}:teacher:${rel.teacherId}`,
            },
          }),
          prisma.commissionEvent.update({
            where: { id: event.id },
            data: {
              ceoCut: Number(
                (event.ceoCut.toNumber() - teacherCutAmount).toFixed(2)
              ),
            },
          }),
        ]);
        totalCreated += 1;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          // Concurrent backfill beat us; its tx decremented ceoCut.
          continue;
        }
        throw err;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    relationships: relationships.length,
    processed: totalProcessed,
    created: totalCreated,
  });
}
