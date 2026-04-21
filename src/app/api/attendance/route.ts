import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { getAffiliateAttendanceData } from "@/lib/affiliate-portal-data";
import { authOptions } from "@/lib/auth-options";
import { reevaluateCommission } from "@/lib/commission-engine";
import { createNotification } from "@/lib/notifications";
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

    // Count existing attendance to detect the first-ever submission. Do this
    // before the create so the post-create count is (existing + 1) — when
    // existing === 0, this write is the first one.
    const priorAttendanceCount = await prisma.attendance.count({
      where: { userId: session.user.id },
    });
    const isFirstEver = priorAttendanceCount === 0;

    const attendance = await prisma.attendance.create({
      data: {
        userId: session.user.id,
        date,
        timezone,
        note: note ?? null,
      },
    });

    if (isFirstEver) {
      await createNotification({
        userId: session.user.id,
        type: "FIRST_ATTENDANCE_RECORDED",
        title: "Attendance started",
        body: "You've submitted your first attendance. Pending commissions on days you mark attendance will now flow through. Keep marking attendance on days you do marketing.",
        data: { href: "/attendance" },
      });
    }

    // Re-evaluate any forfeited commissions for this user — the engine's
    // ±1-day window handles timezone edges. Pull unique rcids from the
    // user's FORFEITED AFFILIATE splits.
    const forfeitedSplits = await prisma.commissionSplit.findMany({
      where: {
        role: "AFFILIATE",
        recipientId: session.user.id,
        status: "FORFEITED",
      },
      select: { event: { select: { rewardfulCommissionId: true } } },
    });

    const rcids = new Set<string>();
    for (const s of forfeitedSplits) {
      if (s.event.rewardfulCommissionId) rcids.add(s.event.rewardfulCommissionId);
    }

    let reevaluated = 0;
    for (const rcid of rcids) {
      const result = await reevaluateCommission(rcid);
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

  return NextResponse.json(
    await getAffiliateAttendanceData(session.user.id, {
      page,
      limit,
      from,
      to,
    })
  );
}
