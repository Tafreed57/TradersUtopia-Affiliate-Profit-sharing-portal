import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/students/:id/detail
 *
 * Returns the teacher's Commission rows for a student (what the teacher earns
 * per conversion) plus the student's Attendance records.
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

  const [student, commissions, attendance, affiliateEarned, affiliatePaid] = await Promise.all([
    prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, email: true, image: true },
    }),

    // Teacher's cut rows for this student — what the teacher earns per conversion
    prisma.commission.findMany({
      where: {
        affiliateId: studentId,
        teacherId,
        status: { not: "PENDING" },
      },
      orderBy: { conversionDate: "desc" },
      take: 200,
      select: {
        id: true,
        conversionDate: true,
        fullAmountCad: true,
        affiliateCutPercent: true,
        affiliateCutCad: true,
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
      take: 200,
      select: {
        id: true,
        date: true,
        timezone: true,
        note: true,
        submittedAt: true,
      },
    }),

    // Student's own unpaid earnings (affiliate rows, not teacher rows)
    prisma.commission.aggregate({
      where: { affiliateId: studentId, teacherId: null, status: "EARNED" },
      _sum: { affiliateCutCad: true },
    }),

    // Student's own paid earnings
    prisma.commission.aggregate({
      where: { affiliateId: studentId, teacherId: null, status: "PAID" },
      _sum: { affiliateCutCad: true },
    }),
  ]);

  if (!student) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    student,
    depth: relationship.depth,
    teacherCutPercent: relationship.teacherCut.toNumber(),
    affiliateUnpaidCad: affiliateEarned._sum.affiliateCutCad?.toNumber() ?? 0,
    affiliatePaidCad: affiliatePaid._sum.affiliateCutCad?.toNumber() ?? 0,
    commissions: commissions.map((c) => ({
      id: c.id,
      conversionDate: c.conversionDate,
      fullAmountCad: c.fullAmountCad.toNumber(),
      affiliateCutPercent: c.affiliateCutPercent.toNumber(),
      affiliateCutCad: c.affiliateCutCad.toNumber(),
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
