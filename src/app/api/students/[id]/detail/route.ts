import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { getTeacherStudentSplitStatsOne } from "@/lib/rewardful-student-stats";

/**
 * GET /api/students/:id/detail
 *
 * Returns the teacher's TEACHER CommissionSplit rows for a student (what the
 * teacher earns per conversion) plus the student's Attendance records, plus
 * a live teacherUnpaid computed from the student's current Rewardful unpaid ×
 * the teacher's cut percent on this relationship.
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

  const relationship = await prisma.teacherStudent.findFirst({
    where: { teacherId, studentId, status: "ACTIVE" },
    select: { depth: true, teacherCut: true },
  });

  if (!relationship) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const COMMISSION_LIMIT = 200;
  const ATTENDANCE_LIMIT = 200;

  const splitWhere = {
    role: "TEACHER" as const,
    recipientId: teacherId,
    event: { affiliateId: studentId },
    status: { not: "PENDING" as const },
  };

  const [
    student,
    splits,
    attendance,
    teacherSplitStats,
    commissionTotal,
    attendanceTotal,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, email: true, image: true },
    }),

    prisma.commissionSplit.findMany({
      where: splitWhere,
      orderBy: { event: { conversionDate: "desc" } },
      take: COMMISSION_LIMIT,
      select: {
        id: true,
        cutPercent: true,
        cutAmount: true,
        status: true,
        forfeitedToCeo: true,
        forfeitureReason: true,
        paidAt: true,
        event: { select: { conversionDate: true, fullAmount: true, currency: true } },
      },
    }),

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

    getTeacherStudentSplitStatsOne(teacherId, studentId),

    prisma.commissionSplit.count({ where: splitWhere }),
    prisma.attendance.count({ where: { userId: studentId } }),
  ]);

  if (!student) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const teacherCutPercent = relationship.teacherCut.toNumber();

  return NextResponse.json({
    student,
    depth: relationship.depth,
    teacherCutPercent,
    teacherUnpaidCad: teacherSplitStats.teacherUnpaidCad,
    teacherPaidCad: teacherSplitStats.teacherPaidCad,
    dataStale: teacherSplitStats.stale,
    dataReason: teacherSplitStats.reason,
    fetchedAt: teacherSplitStats.fetchedAt,
    commissionTotal,
    attendanceTotal,
    commissionHasMore: commissionTotal > splits.length,
    attendanceHasMore: attendanceTotal > attendance.length,
    commissions: splits.map((s) => ({
      id: s.id,
      conversionDate: s.event.conversionDate,
      fullAmount: s.event.fullAmount.toNumber(),
      teacherCutPercent: s.cutPercent.toNumber(),
      teacherCut: s.cutAmount.toNumber(),
      currency: s.event.currency.toUpperCase() as "USD" | "CAD",
      status: s.status,
      forfeitedToCeo: s.forfeitedToCeo,
      forfeitureReason: s.forfeitureReason,
      paidAt: s.paidAt,
    })),
    attendance,
  });
}
