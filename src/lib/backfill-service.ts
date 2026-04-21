import { processConversion } from "@/lib/commission-engine";
import { hasConfiguredCommissionRates } from "@/lib/commission-rate-config";
import { syncCommissionStatesFromCommissions } from "@/lib/paid-sync-service";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";
import type { RewardfulCommission } from "@/lib/rewardful";

/**
 * Historical commission backfill for a newly linked user.
 *
 * Pulls every commission from the upstream service for this user's affiliate
 * ID and feeds each one through `processConversion` with
 * `skipAttendanceCheck: true` — historical dates have no attendance records,
 * and per product decision all historical rows are treated as earned. Any
 * upstream historical rows already marked paid or voided are then synced
 * immediately so affiliates do not temporarily see stale states.
 *
 * Idempotent via the `idempotencyKey @unique` constraint inside
 * `processConversion` (keyed as `{rewardfulCommissionId}:aff:{id}` and
 * `{rewardfulCommissionId}:teacher:{id}`): already-imported commissions
 * return `{ skipped: true }` and do not create duplicate rows.
 */
export async function runBackfill(userId: string): Promise<{
  imported: number;
  skipped: number;
  failed: number;
  status: "COMPLETED" | "FAILED" | "WAITING_FOR_RATE";
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      rewardfulAffiliateId: true,
      initialCommissionPercent: true,
      recurringCommissionPercent: true,
      ratesConfiguredAt: true,
      backfillStatus: true,
      backfillStartedAt: true,
    },
  });
  if (!user?.rewardfulAffiliateId) {
    return { imported: 0, skipped: 0, failed: 0, status: "FAILED" };
  }

  // Rate-gate: do not import history until admin has explicitly configured
  // the affiliate's rates. Numeric 0 is valid, so we must not treat it as
  // "unset" once onboarding is complete.
  if (!hasConfiguredCommissionRates(user)) {
    // Clear stale IN_PROGRESS so the banner stops re-kicking us every poll
    // past the 10-min stale threshold. A legitimate live backfill wouldn't
    // be here — this block only runs with zero rates, and the guarded
    // kickoff paths never enter runBackfill in that state.
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
    if (
      user.backfillStatus === "IN_PROGRESS" &&
      user.backfillStartedAt &&
      user.backfillStartedAt < staleThreshold
    ) {
      await prisma.user.updateMany({
        where: {
          id: userId,
          backfillStatus: "IN_PROGRESS",
          backfillStartedAt: { lt: staleThreshold },
        },
        data: { backfillStatus: "NOT_STARTED", backfillStartedAt: null },
      });
    }
    return { imported: 0, skipped: 0, failed: 0, status: "WAITING_FOR_RATE" };
  }

  // Atomic claim: only proceed if nobody else is running, or if the prior
  // run has been IN_PROGRESS for >10min (stale lock recovery).
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
  const claimed = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [
        { backfillStatus: { in: ["NOT_STARTED", "COMPLETED", "FAILED"] } },
        {
          backfillStatus: "IN_PROGRESS",
          backfillStartedAt: { lt: staleThreshold },
        },
      ],
    },
    data: {
      backfillStatus: "IN_PROGRESS",
      backfillStartedAt: new Date(),
      backfillError: null,
    },
  });
  if (claimed.count !== 1) {
    return { imported: 0, skipped: 0, failed: 0, status: "FAILED" };
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const commissions = await rewardful.listAllCommissionsForAffiliate(
      user.rewardfulAffiliateId
    );

    // Sort ascending by sale.charged_at (fallback created_at). The initial
    // vs recurring classification in processConversion uses conversionDate
    // comparison, which is order-sensitive at the margins. Oldest-first
    // processing guarantees the first arriving event IS the earliest for
    // its referral, so classification is correct from the first write.
    commissions.sort((a, b) => {
      const aDate = a.sale?.charged_at ?? a.created_at ?? "";
      const bDate = b.sale?.charged_at ?? b.created_at ?? "";
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    });

    for (const commission of commissions) {
      try {
        const conversion = mapCommissionToConversion(
          commission,
          user.rewardfulAffiliateId!
        );
        if (!conversion) {
          console.error(
            `[backfill] skipping commission ${commission.id}: missing or invalid sale data`
          );
          failed++;
          continue;
        }
        const result = await processConversion(conversion, {
          skipAttendanceCheck: true,
        });
        if (result.skipped) skipped++;
        else if (result.success) imported++;
        else failed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack?.replace(/\n/g, " | ") : "";
        console.error(
          `[backfill] commission ${commission.id} failed: ${msg} | stack: ${stack}`
        );
        failed++;
      }
    }

    await syncCommissionStatesFromCommissions(commissions);

    if (failed > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          backfillStatus: "FAILED",
          backfillCompletedAt: new Date(),
          backfillError: `${failed} of ${imported + skipped + failed} records failed to import`,
        },
      });
      return { imported, skipped, failed, status: "FAILED" };
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        backfillStatus: "COMPLETED",
        backfillCompletedAt: new Date(),
        backfillError: null,
      },
    });
    return { imported, skipped, failed, status: "COMPLETED" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.replace(/\n/g, " | ") : "";
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error(
      `[backfill] runBackfill failed for ${userId}: ${name}: ${msg} | stack: ${stack}`
    );
    // Wrap status write so a DB error here doesn't propagate out of runBackfill
    // and mask the original error in Vercel's after() background context.
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          backfillStatus: "FAILED",
          backfillError: `Import failed (${name}): ${msg}`.slice(0, 500),
        },
      });
    } catch (statusErr) {
      const statusMsg =
        statusErr instanceof Error ? statusErr.message : String(statusErr);
      console.error(
        `[backfill] failed to persist FAILED status for ${userId}: ${statusMsg}`
      );
    }
    return { imported, skipped, failed, status: "FAILED" };
  }
}

function mapCommissionToConversion(
  commission: RewardfulCommission,
  affiliateRewardfulId: string
) {
  // Require sale data — commission.amount is the affiliate payout, not the
  // full sale amount. Falling back to it would silently store a wrong
  // fullAmount and produce incorrect commission splits.
  if (!commission.sale) return null;
  const amountRaw = commission.sale.sale_amount_cents;
  if (typeof amountRaw !== "number") return null;
  const amount = amountRaw / 100;
  const currency = (
    commission.sale.currency ?? commission.currency ?? "USD"
  ).toUpperCase();

  const conversionDate =
    commission.sale?.charged_at ??
    commission.created_at ??
    new Date().toISOString();

  return {
    rewardfulCommissionId: commission.id,
    rewardfulReferralId: commission.sale?.referral?.id ?? commission.referral?.id,
    affiliateRewardfulId,
    amount,
    currency,
    conversionDate,
    rawPayload: commission as unknown as Record<string, unknown>,
  };
}
