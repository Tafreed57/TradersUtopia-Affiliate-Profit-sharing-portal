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
      initialCommissionPercent: true,
      recurringCommissionPercent: true,
      canProposeRates: true,
      canBeTeacher: true,
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

      // Recent commissions (last 10) — AFFILIATE splits for this user,
      // joined to event for conversionDate + ceoCutCad.
      prisma.commissionSplit.findMany({
        where: { role: "AFFILIATE", recipientId: id },
        orderBy: { event: { conversionDate: "desc" } },
        take: 10,
        select: {
          id: true,
          cutPercent: true,
          cutCad: true,
          status: true,
          forfeitedToCeo: true,
          event: { select: { conversionDate: true, ceoCutCad: true } },
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
      prisma.commissionSplit.aggregate({
        where: { role: "AFFILIATE", recipientId: id, status: "EARNED" },
        _sum: { cutCad: true },
        _count: true,
      }),

      // Pending commissions parked by the rate-gate (forfeitureReason='rate_not_set')
      prisma.commissionSplit.count({
        where: {
          role: "AFFILIATE",
          recipientId: id,
          status: "PENDING",
          forfeitureReason: "rate_not_set",
        },
      }),
    ]);

  // Calculate total allocation %. With dual rates, surface both so the UI
  // can show which configuration (if either) exceeds the threshold. The
  // higher of the two drives the allocationWarning flag.
  const initialPercent = user.initialCommissionPercent.toNumber();
  const recurringPercent = user.recurringCommissionPercent.toNumber();
  const teacherCuts = teachers.map((t) => ({
    teacherId: t.teacherId,
    teacherName: t.teacher.name ?? t.teacher.email,
    cutPercent: t.teacherCut.toNumber(),
    depth: t.depth,
  }));
  const teacherSum = teacherCuts.reduce((sum, t) => sum + t.cutPercent, 0);
  const totalInitialAllocated = initialPercent + teacherSum;
  const totalRecurringAllocated = recurringPercent + teacherSum;
  const totalAllocated = Math.max(totalInitialAllocated, totalRecurringAllocated);

  return NextResponse.json({
    ...user,
    initialCommissionPercent: initialPercent,
    recurringCommissionPercent: recurringPercent,
    commissionPercent: user.commissionPercent.toNumber(),
    teachers: teacherCuts,
    students: students.map((s) => ({
      relationshipId: s.id,
      id: s.student.id,
      name: s.student.name,
      email: s.student.email,
      status: s.student.status,
      depth: s.depth,
      teacherCut: s.teacherCut.toNumber(),
      createdVia: s.createdVia,
    })),
    recentCommissions: recentCommissions.map((s) => ({
      id: s.id,
      affiliateCutPercent: s.cutPercent.toNumber(),
      affiliateCutCad: s.cutCad.toNumber(),
      ceoCutCad: s.event.ceoCutCad.toNumber(),
      status: s.status,
      forfeitedToCeo: s.forfeitedToCeo,
      conversionDate: s.event.conversionDate,
    })),
    rateHistory: rateHistory.map((r) => ({
      id: r.id,
      previousPercent: r.previousPercent.toNumber(),
      newPercent: r.newPercent.toNumber(),
      field: r.field,
      reason: r.reason,
      changedBy: r.changedBy.name ?? r.changedBy.email,
      createdAt: r.createdAt,
    })),
    totalEarnedCad: totalEarned._sum.cutCad?.toNumber() ?? 0,
    totalConversions: totalEarned._count,
    totalAllocated,
    allocationWarning: totalAllocated > TEACHER_CUT_WARN_THRESHOLD,
    pendingRateNotSetCount,
  });
}

const updateSchema = z.object({
  initialCommissionPercent: z.number().min(0).max(100).optional(),
  recurringCommissionPercent: z.number().min(0).max(100).optional(),
  canProposeRates: z.boolean().optional(),
  canBeTeacher: z.boolean().optional(),
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
    const {
      initialCommissionPercent,
      recurringCommissionPercent,
      canProposeRates,
      canBeTeacher,
      status,
      reason,
    } = updateSchema.parse(body);

    const currentUser = await prisma.user.findUnique({
      where: { id },
      select: {
        initialCommissionPercent: true,
        recurringCommissionPercent: true,
        status: true,
      },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    let rateChanged = false;

    if (
      initialCommissionPercent !== undefined &&
      initialCommissionPercent !==
        currentUser.initialCommissionPercent.toNumber()
    ) {
      updateData.initialCommissionPercent = initialCommissionPercent;
      rateChanged = true;
      await prisma.commissionRateAudit.create({
        data: {
          affiliateId: id,
          changedById: session.user.id,
          previousPercent: currentUser.initialCommissionPercent,
          newPercent: initialCommissionPercent,
          field: "INITIAL",
          reason: reason ?? null,
        },
      });
    }

    if (
      recurringCommissionPercent !== undefined &&
      recurringCommissionPercent !==
        currentUser.recurringCommissionPercent.toNumber()
    ) {
      updateData.recurringCommissionPercent = recurringCommissionPercent;
      rateChanged = true;
      await prisma.commissionRateAudit.create({
        data: {
          affiliateId: id,
          changedById: session.user.id,
          previousPercent: currentUser.recurringCommissionPercent,
          newPercent: recurringCommissionPercent,
          field: "RECURRING",
          reason: reason ?? null,
        },
      });
    }

    if (rateChanged) {
      // Eager cache bust — the re-price below clears this again, but the
      // eager write covers the narrow window between the rate write and the
      // re-price in case a concurrent read hits cache with stale values.
      updateData.lifetimeStatsCachedAt = null;
      updateData.lifetimeStatsJson = Prisma.JsonNull;
    }

    if (canProposeRates !== undefined) {
      updateData.canProposeRates = canProposeRates;
    }

    if (canBeTeacher !== undefined) {
      // Silent admin change — no notification per the silent-admin-changes dogma.
      // Flipping false leaves existing TeacherStudent relationships intact; admin
      // deactivates individual pairings via DELETE /api/admin/teacher-student/:id.
      updateData.canBeTeacher = canBeTeacher;
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

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        initialCommissionPercent: true,
        recurringCommissionPercent: true,
        canProposeRates: true,
        canBeTeacher: true,
        status: true,
      },
    });

    // Auto re-price on ANY rate change. Re-prices all EARNED + PENDING
    // AFFILIATE splits using each event's isRecurring + the updated rates.
    // PAID + VOIDED + FORFEITED untouched. Isolated try/catch: a re-price
    // failure must NOT 500 a successful rate save — admin can invoke the
    // manual POST /recalc-pending endpoint to retry.
    let autoRecalc: { updated: number; teacherRowsAffected: number } | null = null;
    if (rateChanged) {
      try {
        const recalcResult = await runRecalcPending(id, session.user.id);
        if (recalcResult.kind === "ok" && recalcResult.updated > 0) {
          autoRecalc = {
            updated: recalcResult.updated,
            teacherRowsAffected: recalcResult.teacherRowsAffected,
          };
        }
      } catch (recalcErr) {
        const msg = recalcErr instanceof Error ? recalcErr.message : String(recalcErr);
        console.error(`[auto-recalc] failed for affiliate ${id}: ${msg}`);
      }
    }

    return NextResponse.json({
      ...updated,
      initialCommissionPercent: updated.initialCommissionPercent.toNumber(),
      recurringCommissionPercent:
        updated.recurringCommissionPercent.toNumber(),
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
