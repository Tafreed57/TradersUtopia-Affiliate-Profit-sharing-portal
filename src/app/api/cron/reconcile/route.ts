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
 * creates any missing rows, and syncs paid/voided state changes.
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

      for (const commission of commissions) {
        // 1. Check if this commission exists in the portal
        const existing = await prisma.commission.findFirst({
          where: {
            rewardfulCommissionId: commission.id,
            teacherId: null,
          },
          select: { id: true, status: true },
        });

        if (!existing) {
          // Missing — create via processConversion
          if (!commission.sale) continue;
          const amountRaw = commission.sale.sale_amount_cents;
          if (typeof amountRaw !== "number") continue;

          const result = await processConversion(
            {
              rewardfulCommissionId: commission.id,
              rewardfulReferralId: commission.referral?.id,
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

        // 2. Sync state changes for existing rows
        if (commission.state === "paid" && existing.status !== "PAID") {
          await handleCommissionPaid(
            commission.id,
            new Date(commission.paid_at ?? Date.now())
          );
          totalPaidSynced++;
        }

        if (commission.state === "voided" && existing.status !== "VOIDED") {
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

  return NextResponse.json({
    ok: true,
    affiliates: affiliates.length,
    created: totalCreated,
    paidSynced: totalPaidSynced,
    voidedSynced: totalVoidedSynced,
    errors,
  });
}
