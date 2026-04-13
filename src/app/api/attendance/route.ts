import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { reevaluateCommission } from "@/lib/commission-engine";
import { prisma } from "@/lib/prisma";

const submitSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/attendance
 *
 * Submit an attendance record. After submission, re-evaluate any
 * forfeited commissions for that date in case attendance was late.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { date, timezone, note } = submitSchema.parse(body);

    const attendance = await prisma.attendance.create({
      data: {
        userId: session.user.id,
        date,
        timezone,
        note: note ?? null,
      },
    });

    // Re-evaluate any forfeited commissions for this date range
    // (the commission engine checks +/- 1 day for timezone handling)
    const forfeitedCommissions = await prisma.commission.findMany({
      where: {
        affiliateId: session.user.id,
        teacherId: null,
        status: "FORFEITED",
      },
      select: { rewardfulCommissionId: true },
      distinct: ["rewardfulCommissionId"],
    });

    let reevaluated = 0;
    for (const c of forfeitedCommissions) {
      if (!c.rewardfulCommissionId) continue;
      const result = await reevaluateCommission(c.rewardfulCommissionId);
      if (result.updated) reevaluated++;
    }

    return NextResponse.json(
      {
        id: attendance.id,
        date: attendance.date,
        reevaluatedCommissions: reevaluated,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Attendance submission error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/attendance
 *
 * Returns attendance records for the authenticated user.
 * Query params: from, to, page, limit
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
    Math.max(1, Number(url.searchParams.get("limit") ?? "30"))
  );
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: Record<string, unknown> = { userId: session.user.id };

  if (from || to) {
    const dateFilter: Record<string, string> = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;
    where.date = dateFilter;
  }

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        date: true,
        timezone: true,
        note: true,
        submittedAt: true,
      },
    }),
    prisma.attendance.count({ where }),
  ]);

  return NextResponse.json({
    data: records,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
