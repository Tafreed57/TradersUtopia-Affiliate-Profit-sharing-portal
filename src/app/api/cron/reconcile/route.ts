import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { NextRequest, NextResponse } from "next/server";

import { processConversion } from "@/lib/commission-engine";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";
import { handleCommissionPaid, handleCommissionVoided } from "@/lib/payment-service";

/**
 * GET /api/cron/reconcile
 *
 * Vercel Cron — runs every 6 hours.
 * For each linked affiliate: pulls all commissions from Rewardful,
 * creates any missing events, and syncs paid/voided state changes.
 *
 * Protected by CRON_SECRET header check.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const affiliates = await prisma.user.findMany({
    where: {
      rewardfulAffiliateId: { not: null },
      status: "ACTIVE",
    },
    select: {
      id: true,
      rewardfulAffiliateId: true,
      email: true,
    },
  });

  let totalCreated = 0;
  let totalPaidSynced = 0;
  let totalVoidedSynced = 0;
  let errors = 0;

  for (const aff of affiliates) {
    try {
      const commissions = await rewardful.listAllCommissionsForAffiliate(
        aff.rewardfulAffiliateId!
      );

      // Sort ascending — see backfill-service.ts for the classification
      // ordering rationale.
      commissions.sort((a, b) => {
        const aDate = a.sale?.charged_at ?? a.created_at ?? "";
        const bDate = b.sale?.charged_at ?? b.created_at ?? "";
        return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
      });

      for (const commission of commissions) {
        // Check if the event exists, and if any AFFILIATE split reflects
        // current state (for the paid/voided sync check).
        const existing = await prisma.commissionEvent.findUnique({
          where: { rewardfulCommissionId: commission.id },
          select: {
            id: true,
            splits: {
              where: { role: "AFFILIATE" },
              select: { status: true },
              take: 1,
            },
          },
        });

        if (!existing) {
          if (!commission.sale) continue;
          const amountRaw = commission.sale.sale_amount_cents;
          if (typeof amountRaw !== "number") continue;

          const result = await processConversion(
            {
              rewardfulCommissionId: commission.id,
              rewardfulReferralId: commission.sale?.referral?.id ?? commission.referral?.id,
              affiliateRewardfulId: aff.rewardfulAffiliateId!,
              amount: amountRaw / 100,
              currency: commission.sale.currency ?? commission.currency ?? "USD",
              conversionDate:
                commission.sale.charged_at ??
                commission.created_at ??
                new Date().toISOString(),
              rawPayload: commission as unknown as Record<string, unknown>,
            },
            { skipAttendanceCheck: true }
          );
          if (result.success && !result.skipped) totalCreated++;
          continue;
        }

        const affiliateStatus = existing.splits[0]?.status;

        if (commission.state === "paid" && affiliateStatus !== "PAID") {
          await handleCommissionPaid(
            commission.id,
            new Date(commission.paid_at ?? Date.now())
          );
          totalPaidSynced++;
        }

        if (commission.state === "voided" && affiliateStatus !== "VOIDED") {
          await handleCommissionVoided(
            commission.id,
            new Date(commission.voided_at ?? Date.now())
          );
          totalVoidedSynced++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reconcile] ${aff.email}: ${msg}`);
      errors++;
    }
  }

  // Nightly classification repair. Catches the out-of-order webhook race
  // where a newer conversion arrived first and was tagged "initial"
  // incorrectly. Correct classification = earliest conversionDate per
  // referralId is initial, rest are recurring.
  //
  // Per-event atomic flip + reprice. Each event is updated via an array
  // $transaction that:
  //   (a) updates the AFFILIATE split's cutPercent + cutCad — but ONLY if
  //       the split is still EARNED or PENDING (TOCTOU guard). If the split
  //       went PAID or VOIDED between snapshot and tx, updateMany no-ops.
  //   (b) updates the event.isRecurring + ceoCutCad — gated via nested
  //       predicate on the affiliate split being at the post-state
  //       (matching cutPercent + status in EARNED/PENDING). If (a) no-op'd,
  //       (b) also no-ops, so classification stays untouched when the
  //       affiliate split is PAID/VOIDED. "Paid is frozen" — both cutCad
  //       and classification lock at payout.
  //
  // Teacher splits are NOT touched here. Their cutCad is rate-independent
  // (teacherCut% × fullAmount, not a slice of the affiliate cut), so
  // classification changes don't affect them.
  let classificationFlipped = 0;
  let classificationRepriced = 0;
  try {
    const referralEvents = await prisma.commissionEvent.findMany({
      where: { rewardfulReferralId: { not: null } },
      select: {
        id: true,
        affiliateId: true,
        rewardfulReferralId: true,
        conversionDate: true,
        createdAt: true,
        isRecurring: true,
        fullAmountCad: true,
      },
      orderBy: [
        { rewardfulReferralId: "asc" },
        { conversionDate: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
    });

    // Group by referral + identify events whose flag should flip.
    type ReferralEvent = (typeof referralEvents)[number];
    const toFlip: Array<{ event: ReferralEvent; newIsRecurring: boolean }> = [];
    let currentReferralId: string | null = null;
    let indexInReferral = 0;
    for (const e of referralEvents) {
      if (e.rewardfulReferralId !== currentReferralId) {
        currentReferralId = e.rewardfulReferralId;
        indexInReferral = 0;
      }
      const shouldBeRecurring = indexInReferral > 0;
      if (e.isRecurring !== shouldBeRecurring) {
        toFlip.push({ event: e, newIsRecurring: shouldBeRecurring });
      }
      indexInReferral += 1;
    }

    if (toFlip.length > 0) {
      // Preload per-affiliate rates + per-event teacher cut sums so each
      // per-event tx stays small.
      const affiliateIds = [...new Set(toFlip.map((t) => t.event.affiliateId))];
      const users = await prisma.user.findMany({
        where: { id: { in: affiliateIds } },
        select: {
          id: true,
          initialCommissionPercent: true,
          recurringCommissionPercent: true,
        },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      const eventIds = toFlip.map((t) => t.event.id);
      const teacherSplits = await prisma.commissionSplit.findMany({
        where: { eventId: { in: eventIds }, role: "TEACHER" },
        select: { eventId: true, cutCad: true },
      });
      const teacherSumByEvent = new Map<string, Decimal>();
      for (const t of teacherSplits) {
        const prev = teacherSumByEvent.get(t.eventId) ?? new Decimal(0);
        teacherSumByEvent.set(
          t.eventId,
          prev.add(new Decimal(t.cutCad.toString()))
        );
      }

      for (const { event, newIsRecurring } of toFlip) {
        const user = userMap.get(event.affiliateId);
        if (!user) continue;

        const rate = newIsRecurring
          ? new Decimal(user.recurringCommissionPercent.toString())
          : new Decimal(user.initialCommissionPercent.toString());
        const rateNum = rate.toDecimalPlaces(2).toNumber();
        const fullAmount = new Decimal(event.fullAmountCad.toString());
        const teacherTotal =
          teacherSumByEvent.get(event.id) ?? new Decimal(0);
        const newAffiliateCut = fullAmount.mul(rate).div(100);
        const newCeoCut = fullAmount.sub(newAffiliateCut).sub(teacherTotal);

        try {
          // Two parallel update paths, atomic within one array $transaction:
          //
          // Path A (EARNED/PENDING): full re-price. New cutCad reflects the
          // corrected classification × current rate. Event's ceoCutCad
          // recomputed to balance.
          //
          // Path B (FORFEITED + attendance reason): flag-only. Affiliate
          // earned 0, CEO absorbed. But the stored cutPercent is what
          // reevaluateCommission will use later if the affiliate submits
          // attendance — so if classification is wrong, the eventual recovery
          // pays the wrong rate. Update cutPercent to track the corrected
          // classification; leave cutCad at 0 and event.ceoCutCad unchanged
          // (FORFEITED's CEO absorb is rate-independent).
          //
          // Event update (path C) gates on EITHER path having landed. The
          // nested-predicate requires an AFFILIATE split with the new
          // cutPercent AND in an eligible status (EARNED/PENDING/recoverable
          // FORFEITED). If both paths no-op (e.g. affiliate split is PAID),
          // event update no-ops too — classification locks with the frozen cutCad.
          const [earnedRes, forfeitedRes] = await prisma.$transaction([
            prisma.commissionSplit.updateMany({
              where: {
                eventId: event.id,
                role: "AFFILIATE",
                status: { in: ["EARNED", "PENDING"] },
              },
              data: {
                cutPercent: rateNum,
                cutCad: newAffiliateCut.toDecimalPlaces(2).toNumber(),
              },
            }),
            prisma.commissionSplit.updateMany({
              where: {
                eventId: event.id,
                role: "AFFILIATE",
                status: "FORFEITED",
                forfeitureReason: "No attendance submitted for conversion date",
              },
              data: {
                cutPercent: rateNum,
              },
            }),
            // Two event-update paths; only one can fire because an AFFILIATE
            // split is in exactly ONE status at tx-snapshot. The gates
            // ensure the corresponding split-update actually landed before
            // flipping the flag.
            prisma.commissionEvent.updateMany({
              where: {
                id: event.id,
                splits: {
                  some: {
                    role: "AFFILIATE",
                    status: { in: ["EARNED", "PENDING"] },
                    cutPercent: rateNum,
                  },
                },
              },
              data: {
                isRecurring: newIsRecurring,
                ceoCutCad: newCeoCut.toDecimalPlaces(2).toNumber(),
              },
            }),
            prisma.commissionEvent.updateMany({
              where: {
                id: event.id,
                splits: {
                  some: {
                    role: "AFFILIATE",
                    status: "FORFEITED",
                    forfeitureReason:
                      "No attendance submitted for conversion date",
                    cutPercent: rateNum,
                  },
                },
              },
              data: { isRecurring: newIsRecurring },
            }),
          ]);

          const totalFlipped = earnedRes.count + forfeitedRes.count;
          if (totalFlipped > 0) {
            classificationFlipped += 1;
            classificationRepriced += earnedRes.count;
          }
        } catch (txErr) {
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(
            `[reconcile-classify] per-event tx failed ${event.id}: ${msg}`
          );
        }
      }

      // Bust lifetime-stats cache for any affiliate whose events flipped.
      if (classificationFlipped > 0) {
        const flippedAffiliates = [
          ...new Set(toFlip.map((t) => t.event.affiliateId)),
        ];
        await prisma.user.updateMany({
          where: { id: { in: flippedAffiliates } },
          data: {
            lifetimeStatsCachedAt: null,
            lifetimeStatsJson: Prisma.JsonNull,
          },
        });
      }
    }
  } catch (classifyErr) {
    const msg =
      classifyErr instanceof Error ? classifyErr.message : String(classifyErr);
    console.error(`[reconcile-classify] failed: ${msg}`);
    errors++;
  }

  return NextResponse.json({
    ok: true,
    affiliates: affiliates.length,
    created: totalCreated,
    paidSynced: totalPaidSynced,
    voidedSynced: totalVoidedSynced,
    classificationFlipped,
    classificationRepriced,
    errors,
  });
}
