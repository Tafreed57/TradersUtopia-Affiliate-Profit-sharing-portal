import { CommissionStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/affiliates/:id/recalc-pending
 *
 * Recalculates all PENDING commissions with forfeitureReason='rate_not_set'
 * using the affiliate's CURRENT commissionPercent. Re-checks attendance per
 * commission. Writes a single CommissionRateAudit summarizing the recalc.
 *
 * Everything runs inside a serializable interactive transaction so a
 * concurrent rate change cannot leak into the recalc math, and the fan-out
 * updateMany predicates include `status=PENDING` + `rate_not_set` so a
 * concurrent recalc cannot overwrite already-recalculated rows.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminId = session.user.id;
  const { id } = await params;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Re-read the affiliate's rate inside the transaction so a
        // concurrent PATCH cannot race us to stale math.
        const affiliate = await tx.user.findUnique({
          where: { id },
          select: { id: true, commissionPercent: true },
        });
        if (!affiliate) {
          return { kind: "not_found" as const };
        }

        const currentRate = new Decimal(affiliate.commissionPercent.toString());
        if (currentRate.eq(0)) {
          return { kind: "rate_zero" as const };
        }

        // 2. Load pending/rate-gated affiliate rows.
        const pendingRows = await tx.commission.findMany({
          where: {
            affiliateId: id,
            teacherId: null,
            status: "PENDING",
            forfeitureReason: "rate_not_set",
          },
          select: {
            rewardfulCommissionId: true,
            fullAmountCad: true,
            conversionDate: true,
          },
        });

        if (pendingRows.length === 0) {
          return {
            kind: "ok" as const,
            updated: 0,
            teacherRowsAffected: 0,
            newRate: currentRate.toDecimalPlaces(2).toNumber(),
          };
        }

        const rewardfulIds = pendingRows
          .map((r) => r.rewardfulCommissionId)
          .filter((v): v is string => Boolean(v));

        // 3. Load teacher rows for these conversions to sum teacher cuts.
        const teacherRows = rewardfulIds.length
          ? await tx.commission.findMany({
              where: {
                affiliateId: id,
                rewardfulCommissionId: { in: rewardfulIds },
                teacherId: { not: null },
              },
              select: {
                rewardfulCommissionId: true,
                teacherCutCad: true,
              },
            })
          : [];
        const teacherCutsByCommission = new Map<string, Decimal>();
        for (const tr of teacherRows) {
          if (!tr.rewardfulCommissionId) continue;
          const prev =
            teacherCutsByCommission.get(tr.rewardfulCommissionId) ??
            new Decimal(0);
          teacherCutsByCommission.set(
            tr.rewardfulCommissionId,
            prev.add(new Decimal((tr.teacherCutCad ?? 0).toString()))
          );
        }

        // 4. Load the affiliate's attendance once for the re-check.
        const allAttendance = await tx.attendance.findMany({
          where: { userId: id },
          select: { date: true },
        });
        const attendanceSet = new Set(allAttendance.map((a) => a.date));
        function hasAttendanceFor(conversionDate: Date): boolean {
          // Match commission-engine: check conversion date +/- 1 day for tz.
          const d0 = new Date(conversionDate);
          const prev = new Date(d0);
          prev.setUTCDate(prev.getUTCDate() - 1);
          const next = new Date(d0);
          next.setUTCDate(next.getUTCDate() + 1);
          return (
            attendanceSet.has(prev.toISOString().slice(0, 10)) ||
            attendanceSet.has(d0.toISOString().slice(0, 10)) ||
            attendanceSet.has(next.toISOString().slice(0, 10))
          );
        }

        // 5. Fan out per-conversion updateMany. Predicate includes
        // `status=PENDING` + `forfeitureReason=rate_not_set` so a
        // concurrent recalc that already flipped a row cannot be undone.
        let affiliateRowsUpdated = 0;
        let teacherRowsAffected = 0;
        for (const row of pendingRows) {
          if (!row.rewardfulCommissionId) continue;

          const fullAmount = new Decimal(row.fullAmountCad.toString());
          const teacherCutTotal =
            teacherCutsByCommission.get(row.rewardfulCommissionId) ??
            new Decimal(0);
          const newAffiliateCut = fullAmount.mul(currentRate).div(100);
          const hadAttendance = hasAttendanceFor(row.conversionDate);

          let finalStatus: CommissionStatus;
          let forfeitedToCeo: boolean;
          let forfeitureReason: string | null;
          let finalAffiliateCut: Decimal;
          let finalCeoCut: Decimal;

          if (hadAttendance) {
            finalStatus = "EARNED";
            forfeitedToCeo = false;
            forfeitureReason = null;
            finalAffiliateCut = newAffiliateCut;
            finalCeoCut = fullAmount.sub(newAffiliateCut).sub(teacherCutTotal);
          } else {
            finalStatus = "FORFEITED";
            forfeitedToCeo = true;
            forfeitureReason = "No attendance submitted for conversion date";
            finalAffiliateCut = new Decimal(0);
            finalCeoCut = fullAmount.sub(teacherCutTotal);
          }

          const res = await tx.commission.updateMany({
            where: {
              affiliateId: id,
              rewardfulCommissionId: row.rewardfulCommissionId,
              status: "PENDING",
              forfeitureReason: "rate_not_set",
            },
            data: {
              status: finalStatus,
              forfeitedToCeo,
              forfeitureReason,
              affiliateCutPercent: currentRate.toDecimalPlaces(2).toNumber(),
              affiliateCutCad: finalAffiliateCut.toDecimalPlaces(2).toNumber(),
              ceoCutCad: finalCeoCut.toDecimalPlaces(2).toNumber(),
            },
          });

          if (res.count > 0) {
            affiliateRowsUpdated += 1; // one affiliate-row per conversion
            teacherRowsAffected += Math.max(0, res.count - 1);
          }
        }

        // 6. Audit + cache invalidation — only when we actually updated rows.
        if (affiliateRowsUpdated > 0) {
          await tx.commissionRateAudit.create({
            data: {
              affiliateId: id,
              changedById: adminId,
              previousPercent: 0,
              newPercent: currentRate.toDecimalPlaces(2).toNumber(),
              reason: `Bulk recalc of rate-not-set commissions (${affiliateRowsUpdated} conversions)`,
            },
          });
          await tx.user.update({
            where: { id },
            data: {
              lifetimeStatsCachedAt: null,
              lifetimeStatsJson: Prisma.JsonNull,
            },
          });
        }

        return {
          kind: "ok" as const,
          updated: affiliateRowsUpdated,
          teacherRowsAffected,
          newRate: currentRate.toDecimalPlaces(2).toNumber(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result.kind === "rate_zero") {
      return NextResponse.json(
        {
          error:
            "Affiliate rate is still 0. Set a rate before running recalculation.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      updated: result.updated,
      teacherRowsAffected: result.teacherRowsAffected,
      newRate: result.newRate,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[recalc-pending] failed for affiliate ${id}: ${msg}`);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
