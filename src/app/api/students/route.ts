import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/students
 *
 * Returns the teacher's student tree — direct students (depth 1)
 * and their students (depth 2), with commission/attendance summaries.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacherId = session.user.id;

  // Get all students where current user is teacher
  const relationships = await prisma.teacherStudent.findMany({
    where: { teacherId, status: "ACTIVE" },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          email: true,
          commissionPercent: true,
          status: true,
          image: true,
        },
      },
    },
    orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
  });

  if (relationships.length === 0) {
    return NextResponse.json({ students: [], isTeacher: false });
  }

  // Get commission summaries and attendance for each student
  const studentIds = relationships.map((r) => r.studentId);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);

  const baseWhere = { affiliateId: { in: studentIds }, teacherId };

  const [earnedSummaries, paidSummaries, attendanceSummaries] = await Promise.all([
    prisma.commission.groupBy({
      by: ["affiliateId"],
      where: { ...baseWhere, status: "EARNED" },
      _sum: { teacherCutCad: true },
      _count: true,
    }),
    prisma.commission.groupBy({
      by: ["affiliateId"],
      where: { ...baseWhere, status: "PAID" },
      _sum: { teacherCutCad: true },
    }),
    prisma.attendance.groupBy({
      by: ["userId"],
      where: {
        userId: { in: studentIds },
        date: { gte: monthStartStr, lte: monthEndStr },
      },
      _count: true,
    }),
  ]);

  const earnedMap = new Map(
    earnedSummaries.map((s) => [s.affiliateId, { dueNow: s._sum.teacherCutCad?.toNumber() ?? 0, count: s._count }])
  );
  const paidMap = new Map(
    paidSummaries.map((s) => [s.affiliateId, s._sum.teacherCutCad?.toNumber() ?? 0])
  );

  const attendanceMap = new Map(
    attendanceSummaries.map((s) => [s.userId, s._count])
  );

  const students = relationships.map((r) => ({
    id: r.student.id,
    name: r.student.name,
    email: r.student.email,
    image: r.student.image,
    commissionPercent: r.student.commissionPercent.toNumber(),
    status: r.student.status,
    depth: r.depth,
    teacherCutPercent: r.teacherCut.toNumber(),
    teacherDueNowCad: earnedMap.get(r.studentId)?.dueNow ?? 0,
    teacherPaidCad: paidMap.get(r.studentId) ?? 0,
    conversionCount: earnedMap.get(r.studentId)?.count ?? 0,
    attendanceDaysThisMonth: attendanceMap.get(r.studentId) ?? 0,
  }));

  return NextResponse.json({ students, isTeacher: true });
}
