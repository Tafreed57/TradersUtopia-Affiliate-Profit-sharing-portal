import { getCommissionCadAllocations } from "@/lib/commission-cad-service";
import { prisma } from "@/lib/prisma";

/**
 * Teacher's own CommissionSplit aggregates per student, allocated to CAD.
 *
 * Historically this module round-tripped to Rewardful to get the student's
 * UNPAID cents and multiplied by the legacy single-rate commission — a
 * proxy that drifted once admin split initial/recurring rates on the
 * student. CommissionSplit is the authoritative source for what the system
 * owes the teacher, updated by webhook + nightly reconcile + heal-forfeited.
 *
 * `CommissionSplit.cutAmount` stores the event's native currency. CAD values
 * come from the upstream state-level CAD base and each split's exact cut,
 * avoiding drift from today's exchange rate.
 */
export interface TeacherStudentSplitStats {
  teacherUnpaidCad: number;
  teacherDueCad: number;
  teacherPendingCad: number;
  teacherPaidCad: number;
  nextDueAt: string | null;
  fetchedAt: string;
  stale: false;
  reason: "ok";
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getTeacherStudentSplitStats(
  teacherId: string,
  studentIds: string[]
): Promise<Map<string, TeacherStudentSplitStats>> {
  const result = new Map<string, TeacherStudentSplitStats>();
  const ids = Array.from(new Set(studentIds));
  if (ids.length === 0) return result;

  const rows = await prisma.commissionSplit.findMany({
      where: {
        role: "TEACHER",
        recipientId: teacherId,
        status: { in: ["EARNED", "PAID"] },
        event: { affiliateId: { in: ids } },
      },
      select: {
        id: true,
        status: true,
        cutAmount: true,
        event: {
          select: {
            affiliateId: true,
            currency: true,
            upstreamState: true,
            upstreamDueAt: true,
          },
        },
      },
    });
  const allocations = await getCommissionCadAllocations(ids);

  const fetchedAt = new Date().toISOString();
  for (const id of ids) {
        result.set(id, {
      teacherUnpaidCad: 0,
      teacherDueCad: 0,
      teacherPendingCad: 0,
      teacherPaidCad: 0,
      nextDueAt: null,
      fetchedAt,
      stale: false,
      reason: "ok",
    });
  }

  for (const row of rows) {
    const acc = result.get(row.event.affiliateId);
    if (!acc) continue;
    const cad = allocations
      .get(row.event.affiliateId)
      ?.splitCadById.get(row.id)
      ?.toNumber();
    if (cad === undefined) continue;
    if (row.status === "PAID") acc.teacherPaidCad += cad;
    else {
      acc.teacherUnpaidCad += cad;
      if (row.event.upstreamState === "due") acc.teacherDueCad += cad;
      else acc.teacherPendingCad += cad;
      if (
        row.event.upstreamDueAt &&
        row.event.upstreamState !== "due" &&
        (!acc.nextDueAt || row.event.upstreamDueAt < new Date(acc.nextDueAt))
      ) {
        acc.nextDueAt = row.event.upstreamDueAt.toISOString();
      }
    }
  }

  for (const acc of result.values()) {
    acc.teacherUnpaidCad = roundCents(acc.teacherUnpaidCad);
    acc.teacherDueCad = roundCents(acc.teacherDueCad);
    acc.teacherPendingCad = roundCents(acc.teacherPendingCad);
    acc.teacherPaidCad = roundCents(acc.teacherPaidCad);
  }

  return result;
}

export async function getTeacherStudentSplitStatsOne(
  teacherId: string,
  studentId: string
): Promise<TeacherStudentSplitStats> {
  const map = await getTeacherStudentSplitStats(teacherId, [studentId]);
  return (
    map.get(studentId) ?? {
      teacherUnpaidCad: 0,
      teacherDueCad: 0,
      teacherPendingCad: 0,
      teacherPaidCad: 0,
      nextDueAt: null,
      fetchedAt: new Date().toISOString(),
      stale: false,
      reason: "ok",
    }
  );
}
