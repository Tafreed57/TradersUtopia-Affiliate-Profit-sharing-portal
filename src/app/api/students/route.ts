import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import {
  getStudentRewardfulStatsBatch,
  type StudentRewardfulStats,
} from "@/lib/rewardful-student-stats";

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
          status: true,
        },
      },
    },
    orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
  });

  if (myRels.length === 0) {
    return NextResponse.json({
      isTeacher: false,
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

  // Map each depth-2 student back to whichever direct student is their
  // immediate teacher — used to nest them under the right card in the UI.
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

  const baseCommissionWhere = {
    affiliateId: { in: allStudentIds },
    teacherId,
  };

  const [paidSummaries, earnedSummaries, attendanceSummaries, rewardfulStats] =
    await Promise.all([
      prisma.commission.groupBy({
        by: ["affiliateId"],
        where: { ...baseCommissionWhere, status: "PAID" },
        _sum: { teacherCutCad: true },
        _count: true,
      }),
      prisma.commission.groupBy({
        by: ["affiliateId"],
        where: { ...baseCommissionWhere, status: "EARNED" },
        _count: true,
      }),
      prisma.attendance.groupBy({
        by: ["userId"],
        where: {
          userId: { in: allStudentIds },
          date: { gte: monthStartStr, lte: monthEndStr },
        },
        _count: true,
      }),
      getStudentRewardfulStatsBatch(allStudentIds),
    ]);

  const paidMap = new Map(
    paidSummaries.map((s) => [
      s.affiliateId,
      { paid: s._sum.teacherCutCad?.toNumber() ?? 0, count: s._count },
    ])
  );
  const earnedMap = new Map(
    earnedSummaries.map((s) => [s.affiliateId, { count: s._count }])
  );
  const attendanceMap = new Map(
    attendanceSummaries.map((s) => [s.userId, s._count])
  );

  function computeTeacherUnpaid(
    teacherCutPercent: number,
    stats: StudentRewardfulStats | null | undefined
  ): {
    teacherUnpaidCad: number;
    dataStale: boolean;
    dataReason: StudentRewardfulStats["reason"] | "not-linked";
    fetchedAt: string | null;
  } {
    if (!stats) {
      return {
        teacherUnpaidCad: 0,
        dataStale: false,
        dataReason: "not-linked",
        fetchedAt: null,
      };
    }
    // unpaidCents × percent / 100 = scaled cents; / 100 again → dollars (2dp)
    const teacherUnpaidCad =
      Math.round(stats.unpaidCents * teacherCutPercent) / 10000;
    return {
      teacherUnpaidCad: Math.round(teacherUnpaidCad * 100) / 100,
      dataStale: stats.stale,
      dataReason: stats.reason,
      fetchedAt: stats.fetchedAt,
    };
  }

  type RelWithStudent = (typeof myRels)[number];

  function buildStudent(rel: RelWithStudent) {
    const teacherCutPercent = rel.teacherCut.toNumber();
    const stats = rewardfulStats.get(rel.studentId);
    const liveData = computeTeacherUnpaid(teacherCutPercent, stats);
    const paid = paidMap.get(rel.studentId) ?? { paid: 0, count: 0 };
    const earned = earnedMap.get(rel.studentId) ?? { count: 0 };
    return {
      id: rel.student.id,
      name: rel.student.name,
      email: rel.student.email,
      image: rel.student.image,
      commissionPercent: rel.student.commissionPercent.toNumber(),
      status: rel.student.status,
      depth: rel.depth,
      teacherCutPercent,
      teacherUnpaidCad: liveData.teacherUnpaidCad,
      teacherPaidCad: paid.paid,
      conversionCount: paid.count + earned.count,
      attendanceDaysThisMonth: attendanceMap.get(rel.studentId) ?? 0,
      dataStale: liveData.dataStale,
      dataReason: liveData.dataReason,
      fetchedAt: liveData.fetchedAt,
    };
  }

  type BuiltStudent = ReturnType<typeof buildStudent>;

  const subStudentsByParent = new Map<string, BuiltStudent[]>();
  for (const rel of depth2Rels) {
    const parent = parentByDepth2.get(rel.studentId);
    if (!parent) continue;
    const built = buildStudent(rel);
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
  const indirectUnpaidCad = directStudents.reduce(
    (sum, s) =>
      sum + s.subStudents.reduce((sub, st) => sub + st.teacherUnpaidCad, 0),
    0
  );
  const totalPaidCad = directStudents.reduce(
    (sum, s) =>
      sum +
      s.teacherPaidCad +
      s.subStudents.reduce((sub, st) => sub + st.teacherPaidCad, 0),
    0
  );

  return NextResponse.json({
    isTeacher: true,
    grandTotals: {
      totalUnpaidCad:
        Math.round((directUnpaidCad + indirectUnpaidCad) * 100) / 100,
      directUnpaidCad: Math.round(directUnpaidCad * 100) / 100,
      indirectUnpaidCad: Math.round(indirectUnpaidCad * 100) / 100,
      totalPaidCad: Math.round(totalPaidCad * 100) / 100,
    },
    directStudents,
  });
}
