import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/teacher-proposals
 *
 * Returns all PENDING teacher-student proposals for admin review.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const proposals = await prisma.teacherStudent.findMany({
    where: { status: "PENDING" },
    include: {
      teacher: { select: { id: true, name: true, email: true, image: true } },
      student: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    data: proposals.map((p) => ({
      id: p.id,
      proposedCut: p.teacherCut.toNumber(),
      status: p.status,
      createdAt: p.createdAt,
      teacher: p.teacher,
      student: p.student,
    })),
  });
}
