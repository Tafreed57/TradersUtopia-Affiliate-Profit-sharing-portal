import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/commissions
 *
 * Returns paginated commissions for the authenticated user.
 * Query params: page, limit, status, from, to
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? "20"))
  );
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: Record<string, unknown> = {
    affiliateId: session.user.id,
    teacherId: null, // Only the affiliate's own commission entries
  };

  if (status && ["EARNED", "FORFEITED", "PENDING"].includes(status)) {
    where.status = status;
  }

  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);
    where.conversionDate = dateFilter;
  }

  const [commissions, total] = await Promise.all([
    prisma.commission.findMany({
      where,
      orderBy: { conversionDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        affiliateCutPercent: true,
        affiliateCutCad: true,
        status: true,
        forfeitedToCeo: true,
        forfeitureReason: true,
        conversionDate: true,
        processedAt: true,
      },
    }),
    prisma.commission.count({ where }),
  ]);

  return NextResponse.json({
    data: commissions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
