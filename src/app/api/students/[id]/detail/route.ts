import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { getStudentRewardfulStats } from "@/lib/rewardful-student-stats";

/**
 * GET /api/students/:id/detail
 *
 * Returns the teacher's Commission rows for a student (what the teacher earns
 * per conversion) plus the student's Attendance records, plus a live
 * teacherUnpaid computed from the student's current Rewardful unpaid × the
 * teacher's cut percent on this relationship.
 *
 * Auth: caller must have an ACTIVE TeacherStudent relationship with the student.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: studentId } = await params;
  const teacherId = session.user.id;

  // Verify active relationship (any depth)
  const relationship = await prisma.teacherStudent.findFirst({
    where: { teacherId, studentId, status: "ACTIVE" },
    select: { depth: true, teacherCut: true },
  });

  if (!relationship) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const COMMISSION_LIMIT = 200;
  const ATTENDANCE_LIMIT = 200;
  const commissionWhere = {
    affiliateId: studentId,
    teacherId,
    status: { not: "PENDING" as const },
  };
  const [
    student,
    commissions,
    attendance,
    rewardfulStats,
    commissionTotal,
    attendanceTotal,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, email: true, image: true },
    }),

    // Teacher's cut rows for this student — what the teacher earns per conversion
    prisma.commission.findMany({
      where: commissionWhere,
      orderBy: { conversionDate: "desc" },
      take: COMMISSION_LIMIT,
      select: {
        id: true,
        conversionDate: true,
        fullAmountCad: true,
        teacherCutPercent: true,
        teacherCutCad: true,
        status: true,
        forfeitedToCeo: true,
        forfeitureReason: true,
        paidAt: true,
      },
    }),

    // Student's attendance records
    prisma.attendance.findMany({
      where: { userId: studentId },
      orderBy: { date: "desc" },
      take: ATTENDANCE_LIMIT,
      select: {
        id: true,
        date: true,
        timezone: true,
        note: true,
        submittedAt: true,
      },
    }),

    // Live Rewardful stats for the student (with cache + 10s timeout)
    getStudentRewardfulStats(studentId),

    prisma.commission.count({ where: commissionWhere }),
    prisma.attendance.count({ where: { userId: studentId } }),
  ]);

  if (!student) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const teacherCutPercent = relationship.teacherCut.toNumber();
  const teacherUnpaidCad = rewardfulStats
    ? Math.round(rewardfulStats.unpaidCents * teacherCutPercent) / 10000
    : 0;
  const teacherPaidCad = commissions
    .filter((c) => c.status === "PAID")
    .reduce((sum, c) => sum + (c.teacherCutCad?.toNumber() ?? 0), 0);

  return NextResponse.json({
    student,
    depth: relationship.depth,
    teacherCutPercent,
    teacherUnpaidCad: Math.round(teacherUnpaidCad * 100) / 100,
    teacherPaidCad: Math.round(teacherPaidCad * 100) / 100,
    dataStale: rewardfulStats?.stale ?? false,
    dataReason: rewardfulStats?.reason ?? "not-linked",
    fetchedAt: rewardfulStats?.fetchedAt ?? null,
    commissionTotal,
    attendanceTotal,
    commissionHasMore: commissionTotal > commissions.length,
    attendanceHasMore: attendanceTotal > attendance.length,
    commissions: commissions.map((c) => ({
      id: c.id,
      conversionDate: c.conversionDate,
      fullAmountCad: c.fullAmountCad.toNumber(),
      teacherCutPercent: c.teacherCutPercent?.toNumber() ?? 0,
      teacherCutCad: c.teacherCutCad?.toNumber() ?? 0,
      status: c.status,
      forfeitedToCeo: c.forfeitedToCeo,
      forfeitureReason: c.forfeitureReason,
      paidAt: c.paidAt,
    })),
    attendance,
  });
}
