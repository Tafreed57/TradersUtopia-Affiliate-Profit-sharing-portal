import { NextRequest, NextResponse } from "next/server";

import { processConversion } from "@/lib/commission-engine";
import { prisma } from "@/lib/prisma";
import { runRecalcPending } from "@/lib/recalc-pending";
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

  // Nightly classification repair. Recomputes `isRecurring` for every event
  // based on chronological order within its referralId. Catches the out-of-
  // order webhook race where a newer conversion arrived first and was
  // tagged initial incorrectly. Each event whose flag flips triggers a
  // re-price for that affiliate so split cutCad + event ceoCutCad track
  // the corrected classification. Idempotent — `isRecurring = (rn > 1)`
  // no-ops when already correct.
  //
  // Events with any PAID or VOIDED split are EXCLUDED from the flip:
  // re-pricing would skip those splits (PAID is immutable) and leave cutCad
  // inconsistent with the corrected classification. Freezing classification
  // on terminal splits matches the "paid is frozen" dogma — the affiliate
  // was paid what they were paid. Residual cosmetic mismatch only.
  let classificationFlipped = 0;
  let classificationRepriced = 0;
  try {
    const affected = await prisma.$queryRaw<
      Array<{ id: string; affiliateId: string }>
    >`
      WITH ranked AS (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY "rewardfulReferralId"
            ORDER BY "conversionDate" ASC, "createdAt" ASC, id ASC
          ) AS rn
        FROM "CommissionEvent"
        WHERE "rewardfulReferralId" IS NOT NULL
      )
      UPDATE "CommissionEvent" e
      SET "isRecurring" = (r.rn > 1)
      FROM ranked r
      WHERE e.id = r.id
        AND e."isRecurring" <> (r.rn > 1)
        AND NOT EXISTS (
          SELECT 1 FROM "CommissionSplit" cs
          WHERE cs."eventId" = e.id
            AND cs.status IN ('PAID', 'VOIDED')
        )
      RETURNING e.id, e."affiliateId"
    `;
    classificationFlipped = affected.length;

    const affectedAffiliateIds = [...new Set(affected.map((a) => a.affiliateId))];
    for (const affId of affectedAffiliateIds) {
      try {
        const result = await runRecalcPending(affId, "cron");
        if (result.kind === "ok") classificationRepriced += result.updated;
      } catch (repriceErr) {
        const msg =
          repriceErr instanceof Error ? repriceErr.message : String(repriceErr);
        console.error(`[reconcile-classify] re-price failed ${affId}: ${msg}`);
      }
    }
  } catch (classifyErr) {
    const msg =
      classifyErr instanceof Error ? classifyErr.message : String(classifyErr);
    console.error(`[reconcile-classify] SQL failed: ${msg}`);
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
