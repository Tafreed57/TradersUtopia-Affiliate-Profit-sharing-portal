import { CommissionStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";

import { prisma } from "@/lib/prisma";

export type RecalcResult =
  | { kind: "not_found" }
  | { kind: "rate_zero" }
  | { kind: "ok"; updated: number; teacherRowsAffected: number; newRate: number };

/**
 * Recalculates all AFFILIATE splits with forfeitureReason='rate_not_set' for
 * an affiliate, applying their CURRENT commissionPercent. Re-checks attendance
 * per event.
 *
 * Intentionally runs WITHOUT a Prisma interactive transaction — Supabase uses
 * PgBouncer in transaction mode, which routes each statement to a different
 * backend connection and causes P2028 on multi-statement interactive txns.
 * Idempotency is enforced by the updateMany predicate (status=PENDING AND
 * forfeitureReason=rate_not_set) — a crashed or concurrent recalc skips
 * already-processed rows. Re-running is safe.
 *
 * Since per-event fields (fullAmount, ceoCut) live on CommissionEvent and
 * per-recipient fields (status, cutCad) live on CommissionSplit, the old
 * 5a/5b two-pass "duplicate fields sync" collapses: each event's ceoCutCad
 * updates once, each split's status/cutCad updates once.
 *
 * Called from:
 *  - POST /api/admin/affiliates/:id/recalc-pending (manual admin button)
 *  - PATCH /api/admin/affiliates/:id (auto-trigger on first rate set 0→positive)
 */
export async function runRecalcPending(
  affiliateId: string,
  adminId: string
): Promise<RecalcResult> {
  const affiliate = await prisma.user.findUnique({
    where: { id: affiliateId },
    select: { id: true, commissionPercent: true },
  });
  if (!affiliate) return { kind: "not_found" as const };

  const currentRate = new Decimal(affiliate.commissionPercent.toString());
  if (currentRate.eq(0)) return { kind: "rate_zero" as const };

  // Load pending/rate-gated AFFILIATE splits along with their parent event.
  const pendingSplits = await prisma.commissionSplit.findMany({
    where: {
      role: "AFFILIATE",
      recipientId: affiliateId,
      status: "PENDING",
      forfeitureReason: "rate_not_set",
    },
    select: {
      id: true,
      event: {
        select: {
          id: true,
          rewardfulCommissionId: true,
          fullAmountCad: true,
          ceoCutCad: true,
          conversionDate: true,
        },
      },
    },
  });

  if (pendingSplits.length === 0) {
    return {
      kind: "ok" as const,
      updated: 0,
      teacherRowsAffected: 0,
      newRate: currentRate.toDecimalPlaces(2).toNumber(),
    };
  }

  const eventIds = pendingSplits.map((s) => s.event.id);

  // Sum teacher cuts per event so we can compute the correct ceoCutCad.
  // Teacher splits are unchanged by recalc; we only read their cutCad totals.
  const teacherSplits = await prisma.commissionSplit.findMany({
    where: { eventId: { in: eventIds }, role: "TEACHER" },
    select: { eventId: true, cutCad: true },
  });
  const teacherCutsByEvent = new Map<string, Decimal>();
  for (const t of teacherSplits) {
    const prev = teacherCutsByEvent.get(t.eventId) ?? new Decimal(0);
    teacherCutsByEvent.set(
      t.eventId,
      prev.add(new Decimal(t.cutCad.toString()))
    );
  }

  // Load affiliate's attendance for the re-check.
  const allAttendance = await prisma.attendance.findMany({
    where: { userId: affiliateId },
    select: { date: true },
  });
  const attendanceSet = new Set(allAttendance.map((a) => a.date));
  const earliestAttendanceDate =
    allAttendance.length > 0
      ? allAttendance.reduce(
          (min, a) => (a.date < min ? a.date : min),
          allAttendance[0].date
        )
      : null;

  function hasAttendanceFor(conversionDate: Date): boolean {
    const convDateStr = conversionDate.toISOString().slice(0, 10);
    if (!earliestAttendanceDate || earliestAttendanceDate > convDateStr) {
      return true;
    }
    const d0 = new Date(conversionDate);
    const prev = new Date(d0);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const next = new Date(d0);
    next.setUTCDate(next.getUTCDate() + 1);
    return (
      attendanceSet.has(prev.toISOString().slice(0, 10)) ||
      attendanceSet.has(convDateStr) ||
      attendanceSet.has(next.toISOString().slice(0, 10))
    );
  }

  const noAttendanceReason = "No attendance submitted for conversion date";
  let affiliateRowsUpdated = 0;
  let teacherRowsAffected = 0;

  const processed: Array<{
    splitId: string;
    eventId: string;
    fullAmountCad: string;
    conversionDate: Date;
    hadAttendance: boolean;
  }> = [];

  for (const p of pendingSplits) {
    const fullAmount = new Decimal(p.event.fullAmountCad.toString());
    const teacherCutTotal =
      teacherCutsByEvent.get(p.event.id) ?? new Decimal(0);
    const newAffiliateCut = fullAmount.mul(currentRate).div(100);
    const hadAttendance = hasAttendanceFor(p.event.conversionDate);

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

    // Predicate-guarded: concurrent recalc that already processed this split
    // returns count=0 and we skip.
    const affRes = await prisma.commissionSplit.updateMany({
      where: {
        id: p.id,
        status: "PENDING",
        forfeitureReason: "rate_not_set",
      },
      data: {
        status: finalStatus,
        forfeitedToCeo,
        forfeitureReason,
        cutPercent: currentRate.toDecimalPlaces(2).toNumber(),
        cutCad: finalAffiliateCut.toDecimalPlaces(2).toNumber(),
      },
    });
    if (affRes.count === 0) continue;
    affiliateRowsUpdated += 1;

    // Per-event field — updated once per event.
    await prisma.commissionEvent.update({
      where: { id: p.event.id },
      data: { ceoCutCad: finalCeoCut.toDecimalPlaces(2).toNumber() },
    });

    processed.push({
      splitId: p.id,
      eventId: p.event.id,
      fullAmountCad: p.event.fullAmountCad.toString(),
      conversionDate: p.event.conversionDate,
      hadAttendance,
    });

    // Teacher splits: flip status only. cutCad was already correct at import
    // time (teachers always keep their cut per product rule; FORFEITED is a
    // label for the rate-gate + no-attendance windows).
    if (hadAttendance) {
      const recovered = await prisma.commissionSplit.updateMany({
        where: {
          eventId: p.event.id,
          role: "TEACHER",
          OR: [
            { status: "FORFEITED", forfeitureReason: noAttendanceReason },
            { status: "PENDING" },
          ],
        },
        data: {
          status: "EARNED",
          forfeitureReason: null,
          forfeitedToCeo: false,
        },
      });
      teacherRowsAffected += recovered.count;
    } else {
      const flipped = await prisma.commissionSplit.updateMany({
        where: {
          eventId: p.event.id,
          role: "TEACHER",
          status: "PENDING",
        },
        data: {
          status: "FORFEITED",
          forfeitureReason: noAttendanceReason,
          forfeitedToCeo: false,
        },
      });
      teacherRowsAffected += flipped.count;
    }
  }

  if (affiliateRowsUpdated > 0) {
    await prisma.commissionRateAudit.create({
      data: {
        affiliateId,
        changedById: adminId,
        previousPercent: 0,
        newPercent: currentRate.toDecimalPlaces(2).toNumber(),
        reason: `Bulk recalc of rate-not-set commissions (${affiliateRowsUpdated} conversions)`,
      },
    });
    await prisma.user.update({
      where: { id: affiliateId },
      data: {
        lifetimeStatsCachedAt: null,
        lifetimeStatsJson: Prisma.JsonNull,
      },
    });
  }

  // Rate drift compensation: re-read rate; if changed, re-price processed rows.
  const verifiedUser = await prisma.user.findUnique({
    where: { id: affiliateId },
    select: { commissionPercent: true },
  });
  const verifiedRate = new Decimal(verifiedUser!.commissionPercent.toString());
  if (!verifiedRate.eq(currentRate) && processed.length > 0) {
    console.error(
      `[recalc] rate drifted mid-recalc for affiliate ${affiliateId}: ` +
        `${currentRate.toFixed(2)}% → ${verifiedRate.toFixed(2)}%. Re-pricing ${processed.length} rows.`
    );
    for (const pr of processed) {
      const fullAmount = new Decimal(pr.fullAmountCad);
      const teacherCutTotal =
        teacherCutsByEvent.get(pr.eventId) ?? new Decimal(0);
      const correctedCut = fullAmount.mul(verifiedRate).div(100);
      const correctedCeoCut = pr.hadAttendance
        ? fullAmount.sub(correctedCut).sub(teacherCutTotal)
        : fullAmount.sub(teacherCutTotal);

      await prisma.commissionSplit.update({
        where: { id: pr.splitId },
        data: {
          cutPercent: verifiedRate.toDecimalPlaces(2).toNumber(),
          cutCad: pr.hadAttendance
            ? correctedCut.toDecimalPlaces(2).toNumber()
            : 0,
        },
      });
      await prisma.commissionEvent.update({
        where: { id: pr.eventId },
        data: { ceoCutCad: correctedCeoCut.toDecimalPlaces(2).toNumber() },
      });
    }
    return {
      kind: "ok" as const,
      updated: affiliateRowsUpdated,
      teacherRowsAffected,
      newRate: verifiedRate.toDecimalPlaces(2).toNumber(),
    };
  }

  return {
    kind: "ok" as const,
    updated: affiliateRowsUpdated,
    teacherRowsAffected,
    newRate: currentRate.toDecimalPlaces(2).toNumber(),
  };
}
