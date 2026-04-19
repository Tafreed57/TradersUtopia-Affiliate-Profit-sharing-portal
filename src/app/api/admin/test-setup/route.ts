import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { runBackfill } from "@/lib/backfill-service";
import { prisma } from "@/lib/prisma";
import { listCommissions } from "@/lib/rewardful";

/**
 * POST /api/admin/test-setup
 *
 * One-shot admin endpoint to onboard a test affiliate end-to-end:
 *   1. find user by email (must already exist via OAuth sign-in)
 *   2. set initial + recurring commission rates (with audit rows)
 *   3. trigger backfill from Rewardful and wait for completion
 *   4. sync paid state from Rewardful onto local splits
 *   5. optionally backdate attendance records
 *
 * Returns a summary so you can sanity-check the state without clicking
 * through admin UI for each step. Not exposed in the UI — call via curl /
 * admin script for rapid test cycles.
 */
const bodySchema = z.object({
  email: z.string().email(),
  initialRate: z.number().min(0).max(100),
  recurringRate: z.number().min(0).max(100),
  runBackfill: z.boolean().default(true),
  runSyncPaid: z.boolean().default(true),
  submitAttendanceDays: z.number().int().min(0).max(60).default(0),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: {
      id: true,
      email: true,
      initialCommissionPercent: true,
      recurringCommissionPercent: true,
      rewardfulAffiliateId: true,
      backfillStatus: true,
    },
  });

  if (!user) {
    return NextResponse.json(
      {
        error:
          "User not found. They must sign in via OAuth first so we can create their User record and link Rewardful.",
      },
      { status: 404 }
    );
  }

  if (!user.rewardfulAffiliateId) {
    return NextResponse.json(
      { error: "User exists but has no Rewardful affiliate link yet." },
      { status: 409 }
    );
  }

  const steps: Record<string, unknown> = {};

  // Step 1: set rates (with audit rows on changes).
  const updateData: Record<string, number> = {};
  if (body.initialRate !== user.initialCommissionPercent.toNumber()) {
    updateData.initialCommissionPercent = body.initialRate;
    await prisma.commissionRateAudit.create({
      data: {
        affiliateId: user.id,
        changedById: session.user.id,
        previousPercent: user.initialCommissionPercent,
        newPercent: body.initialRate,
        field: "INITIAL",
        reason: "test-setup",
      },
    });
  }
  if (body.recurringRate !== user.recurringCommissionPercent.toNumber()) {
    updateData.recurringCommissionPercent = body.recurringRate;
    await prisma.commissionRateAudit.create({
      data: {
        affiliateId: user.id,
        changedById: session.user.id,
        previousPercent: user.recurringCommissionPercent,
        newPercent: body.recurringRate,
        field: "RECURRING",
        reason: "test-setup",
      },
    });
  }
  if (Object.keys(updateData).length > 0) {
    await prisma.user.update({ where: { id: user.id }, data: updateData });
    steps.rates = {
      initialRate: body.initialRate,
      recurringRate: body.recurringRate,
    };
  } else {
    steps.rates = { skipped: "already at requested rates" };
  }

  // Step 2: backfill (waits for completion synchronously).
  if (body.runBackfill) {
    const result = await runBackfill(user.id);
    steps.backfill = result;
  }

  // Step 3: sync-paid — pulls Rewardful state=paid pages and flips matching
  // EARNED splits to PAID. Affiliate-scoped inside the loop so we don't
  // clobber other test users' data during rapid cycles.
  if (body.runSyncPaid) {
    let page = 1;
    let totalFetched = 0;
    let totalUpdated = 0;
    const MAX_PAGES = 50;

    while (page <= MAX_PAGES) {
      const resp = await listCommissions({
        state: "paid",
        limit: 100,
        page,
        affiliate_id: user.rewardfulAffiliateId,
      });
      const items = resp.data ?? [];
      totalFetched += items.length;

      const byPaidAt = new Map<string, string[]>();
      for (const item of items) {
        if (!item.paid_at) continue;
        const arr = byPaidAt.get(item.paid_at) ?? [];
        arr.push(item.id);
        byPaidAt.set(item.paid_at, arr);
      }

      for (const [paidAtStr, rcids] of byPaidAt) {
        const events = await prisma.commissionEvent.findMany({
          where: { rewardfulCommissionId: { in: rcids } },
          select: { id: true },
        });
        if (events.length === 0) continue;
        const result = await prisma.commissionSplit.updateMany({
          where: {
            eventId: { in: events.map((e) => e.id) },
            status: "EARNED",
          },
          data: { status: "PAID", paidAt: new Date(paidAtStr) },
        });
        totalUpdated += result.count;
      }

      if (!resp.pagination.next_page) break;
      page++;
    }

    steps.syncPaid = { fetched: totalFetched, updated: totalUpdated };
  }

  // Step 4: backdate attendance. One row per day for the past N days.
  // The Attendance model has no unique on (userId, date) — the product
  // allows multiple submissions per day — so skipDuplicates won't help.
  // Pre-filter: query existing dates in range and insert only the missing
  // ones. Idempotent across repeated test-setup runs.
  if (body.submitAttendanceDays > 0) {
    const today = new Date();
    const wantDates: string[] = [];
    for (let i = 0; i < body.submitAttendanceDays; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      wantDates.push(d.toISOString().slice(0, 10));
    }

    const existing = await prisma.attendance.findMany({
      where: { userId: user.id, date: { in: wantDates } },
      select: { date: true },
    });
    const existingSet = new Set(existing.map((r) => r.date));
    const rows = wantDates
      .filter((date) => !existingSet.has(date))
      .map((date) => ({ userId: user.id, date, timezone: "UTC" }));

    let created = 0;
    if (rows.length > 0) {
      const result = await prisma.attendance.createMany({ data: rows });
      created = result.count;
    }
    steps.attendance = {
      daysBackdated: created,
      alreadyExisted: wantDates.length - rows.length,
    };
  }

  // Final summary — re-read user + split counts for a clean verification view.
  const finalUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      initialCommissionPercent: true,
      recurringCommissionPercent: true,
      backfillStatus: true,
    },
  });
  const splitCounts = await prisma.commissionSplit.groupBy({
    by: ["status"],
    where: { role: "AFFILIATE", recipientId: user.id },
    _count: true,
  });

  return NextResponse.json({
    ok: true,
    user: {
      email: user.email,
      initialRate: finalUser?.initialCommissionPercent.toNumber(),
      recurringRate: finalUser?.recurringCommissionPercent.toNumber(),
      backfillStatus: finalUser?.backfillStatus,
    },
    splits: Object.fromEntries(splitCounts.map((s) => [s.status, s._count])),
    steps,
  });
}
