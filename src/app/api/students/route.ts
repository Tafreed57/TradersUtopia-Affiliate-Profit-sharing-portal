import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Decimal from "decimal.js";

import { authOptions } from "@/lib/auth-options";
import { getCadToUsdRate } from "@/lib/currency";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/students
 *
 * Teacher-facing student tree:
 *   - direct students (depth 1)
 *   - each direct student's own students nested underneath (depth 2)
 *
 * Teacher's Unpaid per student is computed as
 *   teacherCutPercent × student's current Rewardful unpaid
 * (sourced from the shared lifetimeStatsJson cache, refreshed on miss/stale).
 * Grand totals roll up combined + per-tier.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacherId = session.user.id;

  const me = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { canBeTeacher: true },
  });

  const myRels = await prisma.teacherStudent.findMany({
    where: { teacherId, status: "ACTIVE" },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          commissionPercent: true,
          initialCommissionPercent: true,
          recurringCommissionPercent: true,
          status: true,
        },
      },
    },
    orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
  });

  if (myRels.length === 0) {
    return NextResponse.json({
      isTeacher: false,
      canBeTeacher: me?.canBeTeacher ?? false,
      grandTotals: {
        totalUnpaidCad: 0,
        directUnpaidCad: 0,
        indirectUnpaidCad: 0,
        totalPaidCad: 0,
      },
      directStudents: [],
    });
  }

  const directRels = myRels.filter((r) => r.depth === 1);
  const depth2Rels = myRels.filter((r) => r.depth === 2);
  const directStudentIds = directRels.map((r) => r.studentId);
  const depth2StudentIds = depth2Rels.map((r) => r.studentId);
  const allStudentIds = [...directStudentIds, ...depth2StudentIds];

  const parentByDepth2 = new Map<string, string>();
  if (depth2StudentIds.length > 0 && directStudentIds.length > 0) {
    const parentLinks = await prisma.teacherStudent.findMany({
      where: {
        teacherId: { in: directStudentIds },
        studentId: { in: depth2StudentIds },
        status: "ACTIVE",
        depth: 1,
      },
      select: { teacherId: true, studentId: true },
    });
    for (const link of parentLinks) {
      parentByDepth2.set(link.studentId, link.teacherId);
    }
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);

  // Teacher splits where I'm the recipient, grouped by event.affiliateId.
  // Prisma's groupBy can't traverse relations, so pull splits + event.affiliateId
  // and aggregate in-memory — at our scale (hundreds of splits at most per
  // teacher) the round-trip overhead of a single findMany is negligible.
  // `cutAmount` stores native event currency; normalize USD→CAD using the cached
  // exchange rate so the downstream per-student totals are canonical CAD.
  // See anti-patterns/column-name-as-contract.
  const [teacherSplits, rate] = await Promise.all([
    prisma.commissionSplit.findMany({
      where: {
        role: "TEACHER",
        recipientId: teacherId,
        event: { affiliateId: { in: allStudentIds } },
      },
      select: {
        cutAmount: true,
        status: true,
        event: { select: { affiliateId: true, currency: true } },
      },
    }),
    getCadToUsdRate(),
  ]);

  const cadToUsd = new Decimal(rate?.rate.toString() ?? "0.74");

  // Decimal arithmetic for sums — JS float addition on per-row toNumber()
  // can drift (0.1 + 0.2 = 0.30000000000000004). Accumulate in Decimal, emit
  // rounded 2dp at the end — matches DB-side `_sum` precision of the legacy path.
  type Summary = {
    paid: Decimal;
    unpaid: Decimal;
    paidCount: number;
    earnedCount: number;
  };
  const summaryByStudent = new Map<string, Summary>();
  for (const s of teacherSplits) {
    const sid = s.event.affiliateId;
    const prev = summaryByStudent.get(sid) ?? {
      paid: new Decimal(0),
      unpaid: new Decimal(0),
      paidCount: 0,
      earnedCount: 0,
    };
    const native = new Decimal(s.cutAmount.toString());
    const cad = s.event.currency === "CAD" ? native : native.div(cadToUsd);
    if (s.status === "PAID") {
      prev.paid = prev.paid.add(cad);
      prev.paidCount += 1;
    } else if (s.status === "EARNED") {
      prev.unpaid = prev.unpaid.add(cad);
      prev.earnedCount += 1;
    }
    summaryByStudent.set(sid, prev);
  }

  const attendanceSummaries = await prisma.attendance.groupBy({
    by: ["userId"],
    where: {
      userId: { in: allStudentIds },
      date: { gte: monthStartStr, lte: monthEndStr },
    },
    _count: true,
  });

  const attendanceMap = new Map(
    attendanceSummaries.map((s) => [s.userId, s._count])
  );

  const fetchedAt = new Date().toISOString();

  type RelWithStudent = (typeof myRels)[number];

  function buildStudent(rel: RelWithStudent) {
    const teacherCutPercent = rel.teacherCut.toNumber();
    const summary =
      summaryByStudent.get(rel.studentId) ?? {
        paid: new Decimal(0),
        unpaid: new Decimal(0),
        paidCount: 0,
        earnedCount: 0,
      };
    return {
      id: rel.student.id,
      name: rel.student.name,
      email: rel.student.email,
      image: rel.student.image,
      commissionPercent: rel.student.commissionPercent.toNumber(),
      initialCommissionPercent: rel.student.initialCommissionPercent.toNumber(),
      recurringCommissionPercent: rel.student.recurringCommissionPercent.toNumber(),
      status: rel.student.status,
      depth: rel.depth,
      teacherCutPercent,
      teacherUnpaidCad: summary.unpaid.toDecimalPlaces(2).toNumber(),
      teacherPaidCad: summary.paid.toDecimalPlaces(2).toNumber(),
      conversionCount: summary.paidCount + summary.earnedCount,
      attendanceDaysThisMonth: attendanceMap.get(rel.studentId) ?? 0,
      dataStale: false,
      dataReason: "ok" as const,
      fetchedAt,
    };
  }

  type BuiltStudent = ReturnType<typeof buildStudent>;

  const subStudentsByParent = new Map<string, BuiltStudent[]>();
  const orphanedSubStudents: BuiltStudent[] = [];
  for (const rel of depth2Rels) {
    const parent = parentByDepth2.get(rel.studentId);
    const built = buildStudent(rel);
    if (!parent) {
      console.warn(
        `[api/students] orphaned depth-2 relationship: teacher=${teacherId} student=${rel.studentId} — no active depth-1 parent found in teacher's tree`
      );
      orphanedSubStudents.push(built);
      continue;
    }
    const existing = subStudentsByParent.get(parent) ?? [];
    existing.push(built);
    subStudentsByParent.set(parent, existing);
  }

  const directStudents = directRels.map((r) => ({
    ...buildStudent(r),
    subStudents: subStudentsByParent.get(r.studentId) ?? [],
  }));

  const directUnpaidCad = directStudents.reduce(
    (sum, s) => sum + s.teacherUnpaidCad,
    0
  );
  const indirectUnpaidCad =
    directStudents.reduce(
      (sum, s) =>
        sum + s.subStudents.reduce((sub, st) => sub + st.teacherUnpaidCad, 0),
      0
    ) + orphanedSubStudents.reduce((sum, st) => sum + st.teacherUnpaidCad, 0);
  const totalPaidCad =
    directStudents.reduce(
      (sum, s) =>
        sum +
        s.teacherPaidCad +
        s.subStudents.reduce((sub, st) => sub + st.teacherPaidCad, 0),
      0
    ) + orphanedSubStudents.reduce((sum, st) => sum + st.teacherPaidCad, 0);

  return NextResponse.json({
    isTeacher: true,
    canBeTeacher: me?.canBeTeacher ?? false,
    grandTotals: {
      totalUnpaidCad:
        Math.round((directUnpaidCad + indirectUnpaidCad) * 100) / 100,
      directUnpaidCad: Math.round(directUnpaidCad * 100) / 100,
      indirectUnpaidCad: Math.round(indirectUnpaidCad * 100) / 100,
      totalPaidCad: Math.round(totalPaidCad * 100) / 100,
    },
    directStudents,
    orphanedSubStudents,
  });
}
