import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/commissions
 *
 * Returns paginated commission history for the authenticated user — each row
 * is an AFFILIATE CommissionSplit (what the user earned per conversion).
 *
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
    role: "AFFILIATE",
    recipientId: session.user.id,
  };

  if (status && ["EARNED", "FORFEITED", "PENDING", "PAID", "VOIDED"].includes(status)) {
    where.status = status;
  }

  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);
    where.event = { conversionDate: dateFilter };
  }

  const [splits, total] = await Promise.all([
    prisma.commissionSplit.findMany({
      where,
      orderBy: { event: { conversionDate: "desc" } },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        cutPercent: true,
        cutAmount: true,
        status: true,
        forfeitedToCeo: true,
        forfeitureReason: true,
        createdAt: true,
        event: { select: { conversionDate: true, currency: true } },
      },
    }),
    prisma.commissionSplit.count({ where }),
  ]);

  const data = splits.map((s) => ({
    id: s.id,
    affiliateCutPercent: s.cutPercent,
    affiliateCut: s.cutAmount,
    // Upper-case defensive read: any legacy row with lowercase
    // "usd"/"cad" gets normalized before the FE formatter sees it.
    currency: s.event.currency.toUpperCase() as "USD" | "CAD",
    status: s.status,
    forfeitedToCeo: s.forfeitedToCeo,
    forfeitureReason: s.forfeitureReason,
    conversionDate: s.event.conversionDate,
    processedAt: s.createdAt,
  }));

  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
