import { CommissionStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";

import { prisma } from "@/lib/prisma";

export type RecalcResult =
  | { kind: "not_found" }
  | { kind: "rate_zero" }
  | { kind: "ok"; updated: number; teacherRowsAffected: number; newRate: number };

/**
 * Recalculates all PENDING commissions with forfeitureReason='rate_not_set'
 * for an affiliate, applying their CURRENT commissionPercent. Re-checks
 * attendance per commission.
 *
 * Runs inside a serializable transaction so a concurrent rate change cannot
 * race into the math. Fan-out predicates include status=PENDING +
 * forfeitureReason=rate_not_set so a concurrent recalc cannot overwrite
 * already-recalculated rows.
 *
 * Called from:
 *  - POST /api/admin/affiliates/:id/recalc-pending (manual admin button)
 *  - PATCH /api/admin/affiliates/:id (auto-trigger on first rate set 0→positive)
 */
export async function runRecalcPending(
  affiliateId: string,
  adminId: string
): Promise<RecalcResult> {
  return prisma.$transaction(
    async (tx) => {
      // 1. Re-read affiliate's rate inside transaction to prevent stale math.
      const affiliate = await tx.user.findUnique({
        where: { id: affiliateId },
        select: { id: true, commissionPercent: true },
      });
      if (!affiliate) return { kind: "not_found" as const };

      const currentRate = new Decimal(affiliate.commissionPercent.toString());
      if (currentRate.eq(0)) return { kind: "rate_zero" as const };

      // 2. Load pending/rate-gated affiliate rows.
      const pendingRows = await tx.commission.findMany({
        where: {
          affiliateId,
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

      // 3. Load teacher rows to sum teacher cuts per conversion.
      const teacherRows = rewardfulIds.length
        ? await tx.commission.findMany({
            where: {
              affiliateId,
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

      // 4. Load affiliate's attendance for the re-check.
      const allAttendance = await tx.attendance.findMany({
        where: { userId: affiliateId },
        select: { date: true },
      });
      const attendanceSet = new Set(allAttendance.map((a) => a.date));

      function hasAttendanceFor(conversionDate: Date): boolean {
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

      // 5. Fan out per-conversion updates.
      let affiliateRowsUpdated = 0;
      let teacherRowsAffected = 0;
      const noAttendanceReason = "No attendance submitted for conversion date";

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
          forfeitureReason = noAttendanceReason;
          finalAffiliateCut = new Decimal(0);
          finalCeoCut = fullAmount.sub(teacherCutTotal);
        }

        // 5a. Update the affiliate row.
        const affiliateRes = await tx.commission.updateMany({
          where: {
            affiliateId,
            rewardfulCommissionId: row.rewardfulCommissionId,
            teacherId: null,
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

        if (affiliateRes.count === 0) continue; // lost the race
        affiliateRowsUpdated += 1;

        // 5b. Sync teacher rows. Two-pass to avoid double-counting.
        // Order matters: sync first, then flip. If we flipped first, Pass A's
        // predicate would re-match just-flipped rows and inflate the count.
        const baseTeacherData = {
          affiliateCutPercent: currentRate.toDecimalPlaces(2).toNumber(),
          affiliateCutCad: finalAffiliateCut.toDecimalPlaces(2).toNumber(),
          ceoCutCad: finalCeoCut.toDecimalPlaces(2).toNumber(),
        };

        if (hadAttendance) {
          // Pass A: sync rows not slated for recovery (non-PENDING AND
          // non-(FORFEITED+no-att)). Null-safe OR avoids SQL NULL collapse.
          const synced = await tx.commission.updateMany({
            where: {
              affiliateId,
              rewardfulCommissionId: row.rewardfulCommissionId,
              teacherId: { not: null },
              status: { not: "PENDING" },
              OR: [
                { status: { not: "FORFEITED" } },
                { forfeitureReason: { not: noAttendanceReason } },
                { forfeitureReason: null },
              ],
            },
            data: baseTeacherData,
          });
          // Pass B: recover FORFEITED+no-att OR legacy PENDING → EARNED.
          const recovered = await tx.commission.updateMany({
            where: {
              affiliateId,
              rewardfulCommissionId: row.rewardfulCommissionId,
              teacherId: { not: null },
              OR: [
                { status: "FORFEITED", forfeitureReason: noAttendanceReason },
                { status: "PENDING" },
              ],
            },
            data: {
              ...baseTeacherData,
              status: "EARNED",
              forfeitureReason: null,
              forfeitedToCeo: false,
            },
          });
          teacherRowsAffected += synced.count + recovered.count;
        } else {
          // Pass A: sync non-PENDING teacher rows (just refresh duplicate fields).
          const synced = await tx.commission.updateMany({
            where: {
              affiliateId,
              rewardfulCommissionId: row.rewardfulCommissionId,
              teacherId: { not: null },
              status: { not: "PENDING" },
            },
            data: baseTeacherData,
          });
          // Pass B: flip legacy PENDING teacher rows → FORFEITED.
          const flipped = await tx.commission.updateMany({
            where: {
              affiliateId,
              rewardfulCommissionId: row.rewardfulCommissionId,
              teacherId: { not: null },
              status: "PENDING",
            },
            data: {
              ...baseTeacherData,
              status: "FORFEITED",
              forfeitureReason: noAttendanceReason,
              forfeitedToCeo: false,
            },
          });
          teacherRowsAffected += synced.count + flipped.count;
        }
      }

      // 6. Audit + cache invalidation when rows were updated.
      if (affiliateRowsUpdated > 0) {
        await tx.commissionRateAudit.create({
          data: {
            affiliateId,
            changedById: adminId,
            previousPercent: 0,
            newPercent: currentRate.toDecimalPlaces(2).toNumber(),
            reason: `Bulk recalc of rate-not-set commissions (${affiliateRowsUpdated} conversions)`,
          },
        });
        await tx.user.update({
          where: { id: affiliateId },
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
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
