import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/affiliates
 *
 * Returns all affiliates with summary data. Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const search = req.nextUrl.searchParams.get("search") ?? "";
  const status = req.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "50")));

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  if (status && (status === "ACTIVE" || status === "DEACTIVATED")) {
    where.status = status;
  }

  const [affiliates, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        status: true,
        commissionPercent: true,
        canProposeRates: true,
        rewardfulAffiliateId: true,
        createdAt: true,
        _count: {
          select: {
            commissions: { where: { teacherId: null } },
            studentRelations: { where: { status: "ACTIVE" } },
            teacherRelations: { where: { status: "ACTIVE" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  const data = affiliates.map((a) => ({
    ...a,
    commissionPercent: a.commissionPercent.toNumber(),
    commissionsCount: a._count.commissions,
    studentsCount: a._count.studentRelations,
    teachersCount: a._count.teacherRelations,
    _count: undefined,
  }));

  return NextResponse.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
