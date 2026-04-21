import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/users/search?q=
 *
 * Returns active portal users matching name or email query.
 * Used by teachers on the Students page to find users to propose.
 * Excludes the requesting teacher themselves and anyone already in an
 * ACTIVE or PENDING relationship with them. REJECTED / DEACTIVATED rows are
 * intentionally searchable so the teacher can re-propose them.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ data: [] });
  }

  const teacherId = session.user.id;

  const existing = await prisma.teacherStudent.findMany({
    where: {
      teacherId,
      status: { in: ["ACTIVE", "PENDING"] },
    },
    select: { studentId: true },
  });
  const excludeIds = [teacherId, ...existing.map((r) => r.studentId)];

  const users = await prisma.user.findMany({
    where: {
      id: { notIn: excludeIds },
      status: "ACTIVE",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, image: true },
    take: 10,
  });

  return NextResponse.json({ data: users });
}
