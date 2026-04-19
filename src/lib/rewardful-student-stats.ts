import { getCadToUsdRate } from "@/lib/currency";
import { prisma } from "@/lib/prisma";

/**
 * Teacher's own CommissionSplit aggregates per student, normalized to CAD.
 *
 * Historically this module round-tripped to Rewardful to get the student's
 * UNPAID cents and multiplied by the legacy single-rate commission — a
 * proxy that drifted once admin split initial/recurring rates on the
 * student. CommissionSplit is the authoritative source for what the system
 * owes the teacher, updated by webhook + nightly reconcile + heal-forfeited.
 *
 * `CommissionSplit.cutCad` stores the event's native currency despite the
 * name (see anti-patterns/column-name-as-contract), so we normalize USD
 * rows to CAD server-side before returning. The returned *Cad fields are
 * therefore canonical CAD that the FE can display as-is.
 */
export interface TeacherStudentSplitStats {
  teacherUnpaidCad: number;
  teacherPaidCad: number;
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

  const [rows, rate] = await Promise.all([
    prisma.commissionSplit.findMany({
      where: {
        role: "TEACHER",
        recipientId: teacherId,
        status: { in: ["EARNED", "PAID"] },
        event: { affiliateId: { in: ids } },
      },
      select: {
        status: true,
        cutCad: true,
        event: { select: { affiliateId: true, currency: true } },
      },
    }),
    getCadToUsdRate(),
  ]);

  const cadToUsd = rate?.rate.toNumber() ?? 0.74;

  const fetchedAt = new Date().toISOString();
  for (const id of ids) {
    result.set(id, {
      teacherUnpaidCad: 0,
      teacherPaidCad: 0,
      fetchedAt,
      stale: false,
      reason: "ok",
    });
  }

  for (const row of rows) {
    const acc = result.get(row.event.affiliateId);
    if (!acc) continue;
    const native = row.cutCad.toNumber();
    const cad = row.event.currency === "CAD" ? native : native / cadToUsd;
    if (row.status === "PAID") acc.teacherPaidCad += cad;
    else acc.teacherUnpaidCad += cad;
  }

  for (const acc of result.values()) {
    acc.teacherUnpaidCad = roundCents(acc.teacherUnpaidCad);
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
      teacherPaidCad: 0,
      fetchedAt: new Date().toISOString(),
      stale: false,
      reason: "ok",
    }
  );
}
