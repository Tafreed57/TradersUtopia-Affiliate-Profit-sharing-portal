import { CommissionStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";

import { prisma } from "@/lib/prisma";

export type RecalcResult =
  | { kind: "not_found" }
  | { kind: "ok"; updated: number; teacherRowsAffected: number };

/**
 * Re-prices all UNPAID (EARNED + PENDING) AFFILIATE splits for an affiliate
 * using the current `initialCommissionPercent` / `recurringCommissionPercent`
 * rates on the User row. Each event's `isRecurring` flag picks the rate.
 *
 * Scope:
 *  - EARNED + PENDING affiliate splits: re-priced.
 *  - FORFEITED: frozen (affiliate earned 0; rate is moot; CEO absorbs is
 *    also rate-independent).
 *  - PAID + VOIDED: frozen.
 *
 * Side effects per re-priced split:
 *  - Affiliate split: new cutPercent + cutCad.
 *    PENDING → EARNED when rate > 0 AND attendance passes the grace/±1-day
 *    rule; PENDING → FORFEITED when rate > 0 but attendance failed; PENDING
 *    stays PENDING when rate is still 0; EARNED stays EARNED.
 *  - Event.ceoCutCad recomputed so fullAmount = affiliate + teachers + CEO.
 *  - Teacher splits for the same event flip PENDING → EARNED only when the
 *    affiliate split was promoted to EARNED (rate-independent teacher
 *    cutCad already right; status just catches up).
 *
 * Atomicity: per-event array $transaction. TOCTOU-guarded: the AFFILIATE
 * split updateMany's `where` predicates the current status so a concurrently
 * PAID/VOIDED row is NOT overwritten; the event + teacher-split updates are
 * gated via nested predicate on the affiliate split having reached its
 * post-state, so a no-op split update cascades to a no-op event update.
 *
 * Called by:
 *  - PATCH /api/admin/affiliates/:id on any rate change (auto).
 *  - POST /api/admin/affiliates/:id/recalc-pending (manual admin button).
 */
export async function runRecalcPending(
  affiliateId: string,
  _adminId: string
): Promise<RecalcResult> {
  const affiliate = await prisma.user.findUnique({
    where: { id: affiliateId },
    select: {
      id: true,
      initialCommissionPercent: true,
      recurringCommissionPercent: true,
    },
  });
  if (!affiliate) return { kind: "not_found" };

  const initialRate = new Decimal(affiliate.initialCommissionPercent.toString());
  const recurringRate = new Decimal(
    affiliate.recurringCommissionPercent.toString()
  );

  const splits = await prisma.commissionSplit.findMany({
    where: {
      role: "AFFILIATE",
      recipientId: affiliateId,
      status: { in: ["EARNED", "PENDING"] },
    },
    select: {
      id: true,
      status: true,
      forfeitureReason: true,
      event: {
        select: {
          id: true,
          fullAmountCad: true,
          ceoCutCad: true,
          isRecurring: true,
          conversionDate: true,
        },
      },
    },
  });

  if (splits.length === 0) {
    return { kind: "ok", updated: 0, teacherRowsAffected: 0 };
  }

  // Pre-load teacher cuts + attendance so each per-split decision is cheap.
  const eventIds = splits.map((s) => s.event.id);
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
  let updated = 0;
  let teacherRowsAffected = 0;

  for (const s of splits) {
    const applicableRate = s.event.isRecurring ? recurringRate : initialRate;
    const applicableRateNum = applicableRate.toDecimalPlaces(2).toNumber();
    const fullAmount = new Decimal(s.event.fullAmountCad.toString());
    const teacherCutTotal =
      teacherCutsByEvent.get(s.event.id) ?? new Decimal(0);
    const repricedAffiliateCut = fullAmount.mul(applicableRate).div(100);
    const repricedCeoCut = fullAmount.sub(repricedAffiliateCut).sub(teacherCutTotal);

    // Status transition decision.
    const shouldAttemptPromote =
      s.status === "PENDING" && applicableRate.gt(0);

    let newStatus: CommissionStatus;
    let newForfeitureReason: string | null;
    let newForfeitedToCeo: boolean;
    let finalAffiliateCut: Decimal;
    let finalCeoCut: Decimal;
    let promotedToEarned = false;

    if (shouldAttemptPromote) {
      const hadAttendance = hasAttendanceFor(s.event.conversionDate);
      if (hadAttendance) {
        newStatus = "EARNED";
        newForfeitureReason = null;
        newForfeitedToCeo = false;
        finalAffiliateCut = repricedAffiliateCut;
        finalCeoCut = repricedCeoCut;
        promotedToEarned = true;
      } else {
        // PENDING+rate_not_set but attendance failed: lock it as FORFEITED.
        // CEO absorbs what the affiliate would have earned (independent of
        // the rate now because affiliate gets 0).
        newStatus = "FORFEITED";
        newForfeitureReason = noAttendanceReason;
        newForfeitedToCeo = true;
        finalAffiliateCut = new Decimal(0);
        finalCeoCut = fullAmount.sub(teacherCutTotal);
      }
    } else {
      // EARNED → re-priced; keeps status. Or PENDING with rate still 0 →
      // stays PENDING, cutCad updates to reflect "rate × full" which is 0.
      newStatus = s.status;
      newForfeitureReason = s.forfeitureReason;
      newForfeitedToCeo = false;
      finalAffiliateCut = repricedAffiliateCut;
      finalCeoCut = repricedCeoCut;
    }

    // TOCTOU guard — only update if the split is still in its pre-state.
    // If a concurrent webhook flipped it to PAID/VOIDED between the findMany
    // and this write, count=0 and the cascaded event/teacher writes no-op
    // via the nested-predicate gate.
    const splitUpdate = prisma.commissionSplit.updateMany({
      where: { id: s.id, status: s.status },
      data: {
        status: newStatus,
        forfeitureReason: newForfeitureReason,
        forfeitedToCeo: newForfeitedToCeo,
        cutPercent: applicableRateNum,
        cutCad: finalAffiliateCut.toDecimalPlaces(2).toNumber(),
      },
    });

    // Gate event + teacher updates on the affiliate split having reached the
    // post-state. Same pattern as session-32's array-tx nested gating.
    const postFlipGate = {
      id: s.event.id,
      splits: {
        some: {
          id: s.id,
          status: newStatus,
          cutPercent: applicableRateNum,
        },
      },
    };

    const eventUpdate = prisma.commissionEvent.updateMany({
      where: postFlipGate,
      data: { ceoCutCad: finalCeoCut.toDecimalPlaces(2).toNumber() },
    });

    const ops: Prisma.PrismaPromise<unknown>[] = [splitUpdate, eventUpdate];

    if (promotedToEarned) {
      ops.push(
        prisma.commissionSplit.updateMany({
          where: {
            eventId: s.event.id,
            role: "TEACHER",
            status: "PENDING",
            event: { splits: { some: { id: s.id, status: "EARNED", cutPercent: applicableRateNum } } },
          },
          data: {
            status: "EARNED",
            forfeitureReason: null,
            forfeitedToCeo: false,
          },
        })
      );
    }

    const results = await prisma.$transaction(ops);
    const affRes = results[0] as { count: number };
    if (affRes.count === 0) continue;
    updated += 1;
    if (promotedToEarned) {
      const teacherRes = results[2] as { count: number };
      teacherRowsAffected += teacherRes.count;
    }
  }

  if (updated > 0) {
    await prisma.user.update({
      where: { id: affiliateId },
      data: {
        lifetimeStatsCachedAt: null,
        lifetimeStatsJson: Prisma.JsonNull,
      },
    });
  }

  return { kind: "ok", updated, teacherRowsAffected };
}
