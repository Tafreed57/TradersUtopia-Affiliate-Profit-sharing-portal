import { processConversion } from "@/lib/commission-engine";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";
import type { RewardfulCommission } from "@/lib/rewardful";

/**
 * Historical commission backfill for a newly linked user.
 *
 * Pulls every commission from the upstream service for this user's affiliate
 * ID and feeds each one through `processConversion` with
 * `skipAttendanceCheck: true` — historical dates have no attendance records,
 * and per product decision all historical rows are treated as earned.
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
  status: "COMPLETED" | "FAILED";
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { rewardfulAffiliateId: true },
  });
  if (!user?.rewardfulAffiliateId) {
    return { imported: 0, skipped: 0, failed: 0, status: "FAILED" };
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
  // fullAmountCad and produce incorrect commission splits.
  if (!commission.sale) return null;
  const amountRaw = commission.sale.sale_amount_cents;
  if (typeof amountRaw !== "number") return null;
  const amount = amountRaw / 100;
  const currency = commission.sale.currency ?? commission.currency ?? "USD";

  const conversionDate =
    commission.sale?.charged_at ??
    commission.created_at ??
    new Date().toISOString();

  return {
    rewardfulCommissionId: commission.id,
    rewardfulReferralId: commission.referral?.id,
    affiliateRewardfulId,
    amount,
    currency,
    conversionDate,
    rawPayload: commission as unknown as Record<string, unknown>,
  };
}
