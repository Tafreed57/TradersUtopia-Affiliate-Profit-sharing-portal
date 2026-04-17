import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/teacher-proposals/backfill
 *
 * Retroactively creates teacher Commission rows for all ACTIVE depth-1
 * TeacherStudent relationships. Safe to run multiple times — idempotent
 * via idempotencyKey pre-check (`${commissionId}:teacher:${teacherId}`).
 *
 * Use case: relationships approved before the retroactive-on-approval fix
 * (commit c3538ba) never received teacher Commission rows for commissions
 * that pre-dated the relationship.
 *
 * Returns: { processed: number; created: number; relationships: number }
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only depth-1 (direct) relationships generate teacher Commission rows.
  // Depth-2 rows are derivative — their Commission rows come from new
  // conversions run by the commission engine after the relationship is live.
  const relationships = await prisma.teacherStudent.findMany({
    where: { status: "ACTIVE", depth: 1 },
    select: {
      teacherId: true,
      studentId: true,
      teacherCut: true,
    },
  });

  let totalCreated = 0;
  let totalProcessed = 0;

  for (const rel of relationships) {
    const teacherCutPct = rel.teacherCut.toNumber();
    if (teacherCutPct === 0) continue;

    // Find EARNED affiliate Commission rows for this student that have no
    // teacher row yet (teacherId = null ensures we don't double-count).
    const historicalCommissions = await prisma.commission.findMany({
      where: {
        affiliateId: rel.studentId,
        teacherId: null,
        status: "EARNED",
      },
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

    if (historicalCommissions.length === 0) continue;

    // Pre-check which idempotency keys already exist.
    const candidateKeys = historicalCommissions.map(
      (c) => `${c.id}:teacher:${rel.teacherId}`
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
      .filter((c) => !existingKeys.has(`${c.id}:teacher:${rel.teacherId}`))
      .map((c) => {
        const full = c.fullAmountCad.toNumber();
        const ceo = c.ceoCutCad.toNumber();
        const cut = Math.min(
          Number(((full * teacherCutPct) / 100).toFixed(2)),
          ceo
        );
        return { commission: c, teacherCutCad: cut };
      })
      .filter(({ teacherCutCad }) => teacherCutCad > 0);

    if (toProcess.length === 0) continue;

    // Array-form $transaction: safe with PgBouncer (no interactive tx).
    await prisma.$transaction([
      prisma.commission.createMany({
        data: toProcess.map(({ commission, teacherCutCad }) => ({
          affiliateId: rel.studentId,
          teacherId: rel.teacherId,
          rewardfulCommissionId: commission.rewardfulCommissionId,
          rewardfulReferralId: commission.rewardfulReferralId,
          idempotencyKey: `${commission.id}:teacher:${rel.teacherId}`,
          fullAmountCad: commission.fullAmountCad,
          affiliateCutPercent: 0,
          affiliateCutCad: 0,
          teacherCutPercent: rel.teacherCut,
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

    totalProcessed += historicalCommissions.length;
    totalCreated += toProcess.length;
  }

  return NextResponse.json({
    ok: true,
    relationships: relationships.length,
    processed: totalProcessed,
    created: totalCreated,
  });
}
