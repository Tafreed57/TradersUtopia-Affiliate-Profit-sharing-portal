import { Prisma } from "@prisma/client";
import { after, NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { runBackfill } from "@/lib/backfill-service";
import { getCommissionCadAllocation } from "@/lib/commission-cad-service";
import { hasConfiguredCommissionRates } from "@/lib/commission-rate-config";
import { TEACHER_CUT_WARN_THRESHOLD } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { runRecalcPending } from "@/lib/recalc-pending";

// First-rate-set schedules a backfill via after() on PATCH — give the
// route the same 5-min budget as /api/internal/backfill so Vercel doesn't
// kill the background import mid-flight for affiliates with long history.
export const maxDuration = 300;

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
      accountType: true,
      email: true,
      name: true,
      image: true,
      status: true,
      commissionPercent: true,
      initialCommissionPercent: true,
      recurringCommissionPercent: true,
      canProposeRates: true,
      canBeTeacher: true,
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: true,
      ratesLocked: true,
      ratesConfiguredAt: true,
      rewardfulAffiliateId: true,
      rewardfulEmail: true,
      backfillStatus: true,
      backfillStartedAt: true,
      backfillCompletedAt: true,
      backfillError: true,
      linkError: true,
      linkInProgressAt: true,
      preferredCurrency: true,
      createdAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const affiliateSplitWhere = { role: "AFFILIATE" as const, recipientId: id };
  const earnedOrPaidWhere = {
    ...affiliateSplitWhere,
    status: { in: ["EARNED" as const, "PAID" as const] },
  };

  const [
    teachers,
    students,
    recentCommissions,
    rateHistory,
    payableSplits,
    totalEarnedCount,
    pendingRateNotSetCount,
    cadAllocation,
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
      // joined to event for conversionDate + ceoCut + currency.
      prisma.commissionSplit.findMany({
        where: { role: "AFFILIATE", recipientId: id },
        orderBy: { event: { conversionDate: "desc" } },
        take: 10,
        select: {
          id: true,
          cutPercent: true,
          cutAmount: true,
          status: true,
          forfeitedToCeo: true,
          event: { select: { conversionDate: true, ceoCut: true, currency: true } },
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

      // Provider-anchored CAD totals use exact split percentages.
      prisma.commissionSplit.findMany({
        where: earnedOrPaidWhere,
        select: { id: true },
      }),
      prisma.commissionSplit.count({ where: earnedOrPaidWhere }),

      // Pending commissions parked by the rate-gate (forfeitureReason='rate_not_set')
      prisma.commissionSplit.count({
        where: {
          role: "AFFILIATE",
          recipientId: id,
          status: "PENDING",
          forfeitureReason: "rate_not_set",
        },
      }),

      getCommissionCadAllocation(id),
    ]);

  const totalEarnedCad = Math.round(
    payableSplits.reduce(
      (sum, split) =>
        sum + (cadAllocation.splitCadById.get(split.id)?.toNumber() ?? 0),
      0
    ) * 100
  ) / 100;

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
    ratesConfigured: hasConfiguredCommissionRates(user),
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
      affiliateCut: s.cutAmount.toNumber(),
      affiliateCutCad:
        cadAllocation.splitCadById.get(s.id)?.toDecimalPlaces(2).toNumber() ??
        null,
      ceoCut: s.event.ceoCut.toNumber(),
      currency: s.event.currency.toUpperCase() as "USD" | "CAD",
      status: s.status,
      forfeitedToCeo: s.forfeitedToCeo,
      conversionDate: s.event.conversionDate,
    })),
    rateHistory: rateHistory.map((r) => ({
      id: r.id,
      previousPercent: r.previousPercent.toNumber(),
      newPercent: r.newPercent.toNumber(),
      field: r.field,
      appliedMode: r.appliedMode,
      reason: r.reason,
      changedBy: r.changedBy.name ?? r.changedBy.email,
      createdAt: r.createdAt,
    })),
    totalEarnedCad,
    totalCommissions: totalEarnedCount,
    totalConversions: totalEarnedCount,
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
  canSeeRecurringCommissions: z.boolean().optional(),
  recurringCommissionVisibilityMode: z.enum(["ALL_HISTORY", "FROM_NOW"]).optional(),
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
      canSeeRecurringCommissions,
      recurringCommissionVisibilityMode,
      status,
      reason,
    } = updateSchema.parse(body);

    const currentUser = await prisma.user.findUnique({
      where: { id },
      select: {
        accountType: true,
        initialCommissionPercent: true,
        recurringCommissionPercent: true,
        ratesConfiguredAt: true,
        status: true,
        backfillStatus: true,
        rewardfulAffiliateId: true,
        ratesLocked: true,
        canSeeRecurringCommissions: true,
        recurringCommissionsVisibleFrom: true,
      },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (currentUser.accountType === "WORK" && (
      initialCommissionPercent !== undefined || recurringCommissionPercent !== undefined ||
      canProposeRates !== undefined || canBeTeacher !== undefined ||
      canSeeRecurringCommissions !== undefined || recurringCommissionVisibilityMode !== undefined
    )) {
      return NextResponse.json({ error: "Work accounts do not support commission or teacher settings" }, { status: 403 });
    }

    // Rate changes behave differently based on the lock state:
    //   ratesLocked=false (onboarding): re-price all unpaid splits retroactively.
    //   ratesLocked=true  (locked):     only future webhooks use the new rate;
    //                                   existing splits frozen. Audit captures mode.
    const auditMode = currentUser.ratesLocked ? "FORWARD_ONLY" : "RETROACTIVE";

    const updateData: Record<string, unknown> = {};
    let rateChanged = false;
    const rateInputsTouched =
      initialCommissionPercent !== undefined ||
      recurringCommissionPercent !== undefined;
    const ratesConfiguredNow =
      currentUser.ratesConfiguredAt === null && rateInputsTouched;

    if (ratesConfiguredNow) {
      updateData.ratesConfiguredAt = new Date();
    }

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
          appliedMode: auditMode,
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
          appliedMode: auditMode,
          reason: reason ?? null,
        },
      });
    }

    if (rateChanged || ratesConfiguredNow) {
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

    if (
      canSeeRecurringCommissions !== undefined &&
      canSeeRecurringCommissions !== currentUser.canSeeRecurringCommissions
    ) {
      // Silent admin-only recurring history control. This changes
      // affiliate-facing commission surfaces only; underlying commission rows
      // and totals stay intact.
      updateData.canSeeRecurringCommissions = canSeeRecurringCommissions;
    }

    if (canSeeRecurringCommissions === false) {
      updateData.recurringCommissionsVisibleFrom = null;
    } else if (recurringCommissionVisibilityMode !== undefined) {
      updateData.recurringCommissionsVisibleFrom =
        recurringCommissionVisibilityMode === "FROM_NOW" ? new Date() : null;
    }

    if (
      canSeeRecurringCommissions !== undefined ||
      recurringCommissionVisibilityMode !== undefined
    ) {
      updateData.lifetimeStatsCachedAt = null;
      updateData.lifetimeStatsJson = Prisma.JsonNull;
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
        ratesConfiguredAt: true,
        canProposeRates: true,
        canBeTeacher: true,
        canSeeRecurringCommissions: true,
        recurringCommissionsVisibleFrom: true,
        status: true,
      },
    });

    // Auto re-price on rate change. Two modes:
    //   ratesLocked=false (onboarding): re-price EARNED + promote PENDING
    //     at the updated rates. PAID/VOIDED/FORFEITED always frozen.
    //   ratesLocked=true (locked): PENDING still promotes (those rows
    //     have no price to preserve — leaving them stuck is never the
    //     intent), but EARNED rows stay frozen at their original rate.
    //     Achieved via runRecalcPending(pendingOnly: true).
    // Isolated try/catch: a re-price failure must NOT 500 a successful
    // rate save — admin can invoke POST /recalc-pending to retry.
    let autoRecalc: { updated: number; teacherRowsAffected: number } | null = null;
    if (rateChanged || ratesConfiguredNow) {
      try {
        const recalcResult = await runRecalcPending(id, session.user.id, {
          pendingOnly: currentUser.ratesLocked,
        });
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

    // First-rate-set backfill: if the affiliate had rate-gated out of their
    // initial history import (both rates were 0 at signup, so runBackfill
    // returned WAITING_FOR_RATE and left status=NOT_STARTED), kick the
    // backfill now that at least one rate is configured. Scheduled via
    // after() because a large affiliate history would make this PATCH hang
    // or time out — the user-facing route uses the same pattern.
    let autoBackfillScheduled = false;
    if (
      ratesConfiguredNow &&
      currentUser.rewardfulAffiliateId &&
      currentUser.backfillStatus === "NOT_STARTED"
    ) {
      autoBackfillScheduled = true;
      after(async () => {
        try {
          await runBackfill(id);
        } catch (backfillErr) {
          const msg =
            backfillErr instanceof Error
              ? backfillErr.message
              : String(backfillErr);
          console.error(`[auto-backfill] failed for affiliate ${id}: ${msg}`);
        }
      });
    }

    // Admin rate edits are intentionally silent. The audit rows above are
    // internal-only records; do not create an affiliate notification here.
    return NextResponse.json({
      ...updated,
      initialCommissionPercent: updated.initialCommissionPercent.toNumber(),
      recurringCommissionPercent:
        updated.recurringCommissionPercent.toNumber(),
      ratesConfigured: hasConfiguredCommissionRates(updated),
      ...(autoRecalc ? { autoRecalc } : {}),
      ...(autoBackfillScheduled ? { autoBackfillScheduled: true } : {}),
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
