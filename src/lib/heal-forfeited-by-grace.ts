import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";

import { prisma } from "@/lib/prisma";

export type HealResult = {
  candidates: number;
  healed: number;
  teacherStatusChanges: number;
  usersAffected: number;
};

/**
 * One-shot heal for FORFEITED AFFILIATE CommissionSplits that predate the
 * attendance grace rule. The grace rule exempts commissions from
 * attendance-based forfeiture when the affiliate had NO attendance records
 * on or before the conversion date — the requirement wasn't active yet.
 *
 * Pre-grace-rule rows that should have been exempt but got FORFEITED at
 * import time are re-evaluated here. Idempotent — subsequent runs find no
 * new candidates.
 *
 * Per healed event:
 *  - AFFILIATE split: FORFEITED → EARNED with rate-driven cutAmount + cleared
 *    forfeitureReason + forfeitedToCeo=false.
 *  - CommissionEvent.ceoCut recomputed.
 *  - TEACHER splits with the same attendance reason recover to EARNED.
 *
 * Per-event atomic array $transaction with TOCTOU guard (current status +
 * forfeitureReason predicates). Nested-predicate gate on event + teacher
 * updates no-op if the AFFILIATE flip didn't take (concurrent modification).
 */
export async function healForfeitedByGrace(): Promise<HealResult> {
  const reason = "No attendance submitted for conversion date";

  const candidates = await prisma.commissionSplit.findMany({
    where: {
      role: "AFFILIATE",
      status: "FORFEITED",
      forfeitureReason: reason,
    },
    select: {
      id: true,
      recipientId: true,
      event: {
        select: {
          id: true,
          conversionDate: true,
          fullAmount: true,
          ceoCut: true,
          isRecurring: true,
        },
      },
    },
  });

  if (candidates.length === 0) {
    return {
      candidates: 0,
      healed: 0,
      teacherStatusChanges: 0,
      usersAffected: 0,
    };
  }

  const affiliateIds = [...new Set(candidates.map((c) => c.recipientId))];
  const users = await prisma.user.findMany({
    where: { id: { in: affiliateIds } },
    select: {
      id: true,
      initialCommissionPercent: true,
      recurringCommissionPercent: true,
    },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const attendance = await prisma.attendance.findMany({
    where: { userId: { in: affiliateIds } },
    select: { userId: true, date: true },
  });
  const earliestByUser = new Map<string, string>();
  for (const a of attendance) {
    const prev = earliestByUser.get(a.userId);
    if (!prev || a.date < prev) earliestByUser.set(a.userId, a.date);
  }

  const eventIds = [...new Set(candidates.map((c) => c.event.id))];
  const teacherSplits = await prisma.commissionSplit.findMany({
    where: { eventId: { in: eventIds }, role: "TEACHER" },
    select: { eventId: true, cutAmount: true },
  });
  const teacherCutsByEvent = new Map<string, Decimal>();
  for (const t of teacherSplits) {
    const prev = teacherCutsByEvent.get(t.eventId) ?? new Decimal(0);
    teacherCutsByEvent.set(
      t.eventId,
      prev.add(new Decimal(t.cutAmount.toString()))
    );
  }

  let healed = 0;
  let teacherStatusChanges = 0;
  const healedUsers = new Set<string>();

  for (const c of candidates) {
    const user = userMap.get(c.recipientId);
    if (!user) continue;

    const convDateStr = c.event.conversionDate.toISOString().slice(0, 10);
    const earliest = earliestByUser.get(c.recipientId);
    const graceApplies = !earliest || earliest > convDateStr;
    if (!graceApplies) continue;

    const applicableRate = c.event.isRecurring
      ? new Decimal(user.recurringCommissionPercent.toString())
      : new Decimal(user.initialCommissionPercent.toString());
    const applicableRateNum = applicableRate.toDecimalPlaces(2).toNumber();
    const fullAmount = new Decimal(c.event.fullAmount.toString());
    const teacherCutTotal =
      teacherCutsByEvent.get(c.event.id) ?? new Decimal(0);
    const newAffiliateCut = fullAmount.mul(applicableRate).div(100);
    const newCeoCut = fullAmount.sub(newAffiliateCut).sub(teacherCutTotal);

    const [affRes, , teacherRes] = await prisma.$transaction([
      prisma.commissionSplit.updateMany({
        where: {
          id: c.id,
          status: "FORFEITED",
          forfeitureReason: reason,
        },
        data: {
          status: "EARNED",
          forfeitedToCeo: false,
          forfeitureReason: null,
          cutPercent: applicableRateNum,
          cutAmount: newAffiliateCut.toDecimalPlaces(2).toNumber(),
        },
      }),
      prisma.commissionEvent.updateMany({
        where: {
          id: c.event.id,
          splits: {
            some: {
              id: c.id,
              status: "EARNED",
              cutPercent: applicableRateNum,
            },
          },
        },
        data: { ceoCut: newCeoCut.toDecimalPlaces(2).toNumber() },
      }),
      prisma.commissionSplit.updateMany({
        where: {
          eventId: c.event.id,
          role: "TEACHER",
          status: "FORFEITED",
          forfeitureReason: reason,
          event: {
            splits: {
              some: {
                id: c.id,
                status: "EARNED",
                cutPercent: applicableRateNum,
              },
            },
          },
        },
        data: {
          status: "EARNED",
          forfeitureReason: null,
          forfeitedToCeo: false,
        },
      }),
    ]);

    if (affRes.count > 0) {
      healed += 1;
      healedUsers.add(c.recipientId);
      teacherStatusChanges += teacherRes.count;
    }
  }

  if (healedUsers.size > 0) {
    await prisma.user.updateMany({
      where: { id: { in: [...healedUsers] } },
      data: {
        lifetimeStatsCachedAt: null,
        lifetimeStatsJson: Prisma.JsonNull,
      },
    });
  }

  return {
    candidates: candidates.length,
    healed,
    teacherStatusChanges,
    usersAffected: healedUsers.size,
  };
}
