import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { TEACHER_CUT_WARN_THRESHOLD } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { runRecalcPending } from "@/lib/recalc-pending";

/**
 * GET /api/admin/affiliates/:id
 *
 * Returns detailed affiliate info including teacher chain,
 * student tree, commission history, and rate audit log.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      status: true,
      commissionPercent: true,
      canProposeRates: true,
      rewardfulAffiliateId: true,
      preferredCurrency: true,
      createdAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [
    teachers,
    students,
    recentCommissions,
    rateHistory,
    totalEarned,
    pendingRateNotSetCount,
  ] = await Promise.all([
      // Teachers of this affiliate
      prisma.teacherStudent.findMany({
        where: { studentId: id, status: "ACTIVE" },
        include: {
          teacher: { select: { id: true, name: true, email: true } },
        },
      }),

      // Students of this affiliate
      prisma.teacherStudent.findMany({
        where: { teacherId: id, status: "ACTIVE" },
        include: {
          student: {
            select: { id: true, name: true, email: true, status: true },
          },
        },
      }),

      // Recent commissions (last 10)
      prisma.commission.findMany({
        where: { affiliateId: id, teacherId: null },
        orderBy: { conversionDate: "desc" },
        take: 10,
        select: {
          id: true,
          affiliateCutPercent: true,
          affiliateCutCad: true,
          ceoCutCad: true,
          status: true,
          forfeitedToCeo: true,
          conversionDate: true,
        },
      }),

      // Rate change history
      prisma.commissionRateAudit.findMany({
        where: { affiliateId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          changedBy: { select: { name: true, email: true } },
        },
      }),

      // Total earned
      prisma.commission.aggregate({
        where: { affiliateId: id, teacherId: null, status: "EARNED" },
        _sum: { affiliateCutCad: true },
        _count: true,
      }),

      // Pending commissions parked by the rate-gate (forfeitureReason='rate_not_set')
      prisma.commission.count({
        where: {
          affiliateId: id,
          teacherId: null,
          status: "PENDING",
          forfeitureReason: "rate_not_set",
        },
      }),
    ]);

  // Calculate total allocation %
  const affiliatePercent = user.commissionPercent.toNumber();
  const teacherCuts = teachers.map((t) => ({
    teacherId: t.teacherId,
    teacherName: t.teacher.name ?? t.teacher.email,
    cutPercent: t.teacherCut.toNumber(),
    depth: t.depth,
  }));
  const totalAllocated =
    affiliatePercent +
    teacherCuts.reduce((sum, t) => sum + t.cutPercent, 0);

  return NextResponse.json({
    ...user,
    commissionPercent: affiliatePercent,
    teachers: teacherCuts,
    students: students.map((s) => ({
      id: s.student.id,
      name: s.student.name,
      email: s.student.email,
      status: s.student.status,
      depth: s.depth,
      teacherCut: s.teacherCut.toNumber(),
    })),
    recentCommissions: recentCommissions.map((c) => ({
      ...c,
      affiliateCutPercent: c.affiliateCutPercent.toNumber(),
      affiliateCutCad: c.affiliateCutCad.toNumber(),
      ceoCutCad: c.ceoCutCad.toNumber(),
    })),
    rateHistory: rateHistory.map((r) => ({
      id: r.id,
      previousPercent: r.previousPercent.toNumber(),
      newPercent: r.newPercent.toNumber(),
      reason: r.reason,
      changedBy: r.changedBy.name ?? r.changedBy.email,
      createdAt: r.createdAt,
    })),
    totalEarnedCad: totalEarned._sum.affiliateCutCad?.toNumber() ?? 0,
    totalConversions: totalEarned._count,
    totalAllocated,
    allocationWarning: totalAllocated > TEACHER_CUT_WARN_THRESHOLD,
    pendingRateNotSetCount,
  });
}

const updateSchema = z.object({
  commissionPercent: z.number().min(0).max(100).optional(),
  canProposeRates: z.boolean().optional(),
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
  reason: z.string().optional(),
});

/**
 * PATCH /api/admin/affiliates/:id
 *
 * Admin updates an affiliate's settings. Handles:
 * - Commission rate change (with audit log)
 * - Rate proposal access toggle
 * - Activation/deactivation
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const { commissionPercent, canProposeRates, status, reason } =
      updateSchema.parse(body);

    const currentUser = await prisma.user.findUnique({
      where: { id },
      select: { commissionPercent: true, status: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    // Commission rate change
    if (
      commissionPercent !== undefined &&
      commissionPercent !== currentUser.commissionPercent.toNumber()
    ) {
      updateData.commissionPercent = commissionPercent;
      // Bust cached lifetime-stats — amounts are rate-scaled, stale on rate change.
      updateData.lifetimeStatsCachedAt = null;
      updateData.lifetimeStatsJson = Prisma.JsonNull;

      // Create audit log
      await prisma.commissionRateAudit.create({
        data: {
          affiliateId: id,
          changedById: session.user.id,
          previousPercent: currentUser.commissionPercent,
          newPercent: commissionPercent,
          reason: reason ?? null,
        },
      });

      // Notify affiliate
      await createNotification({
        userId: id,
        type: "COMMISSION_RATE_CHANGED",
        title: "Commission Rate Updated",
        body: `Your commission rate has been changed from ${currentUser.commissionPercent.toNumber()}% to ${commissionPercent}%.`,
        data: {
          previousPercent: currentUser.commissionPercent.toNumber(),
          newPercent: commissionPercent,
        },
      });
    }

    if (canProposeRates !== undefined) {
      updateData.canProposeRates = canProposeRates;
    }

    if (status !== undefined) {
      updateData.status = status;

      // If deactivating, also deactivate teacher relationships
      if (status === "DEACTIVATED") {
        await prisma.teacherStudent.updateMany({
          where: {
            OR: [{ teacherId: id }, { studentId: id }],
            status: { in: ["PENDING", "ACTIVE"] },
          },
          data: { status: "DEACTIVATED" },
        });

        // Notify affiliate about deactivation
        await createNotification({
          userId: id,
          type: "AFFILIATE_DEACTIVATED",
          title: "Account Deactivated",
          body: "Your affiliate account has been deactivated. Contact support for more information.",
        });
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No changes" }, { status: 400 });
    }

    const previousRate = currentUser.commissionPercent.toNumber();

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        commissionPercent: true,
        canProposeRates: true,
        status: true,
      },
    });

    // Auto-trigger recalc when rate moves from 0 → positive for the first time.
    // Rate changes from positive → positive only apply to new commissions.
    // Isolated try/catch: a recalc failure must NOT 500 a successful rate update.
    let autoRecalc: { updated: number; teacherRowsAffected: number; newRate: number } | null = null;
    if (
      commissionPercent !== undefined &&
      previousRate === 0 &&
      commissionPercent > 0
    ) {
      try {
        const recalcResult = await runRecalcPending(id, session.user.id);
        if (recalcResult.kind === "ok" && recalcResult.updated > 0) {
          autoRecalc = {
            updated: recalcResult.updated,
            teacherRowsAffected: recalcResult.teacherRowsAffected,
            newRate: recalcResult.newRate,
          };
        }
      } catch (recalcErr) {
        const msg = recalcErr instanceof Error ? recalcErr.message : String(recalcErr);
        console.error(`[auto-recalc] failed for affiliate ${id}: ${msg}`);
      }
    }

    return NextResponse.json({
      ...updated,
      commissionPercent: updated.commissionPercent.toNumber(),
      ...(autoRecalc ? { autoRecalc } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Admin affiliate update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
