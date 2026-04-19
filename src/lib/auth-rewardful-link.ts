import { adminUserWhereOr } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

/**
 * Time-bounded wrapper for `linkRewardfulAffiliate`. If the call does not
 * complete within `timeoutMs`, returns immediately — the underlying work
 * keeps running in the background (next sign-in will retry if it failed).
 * Prevents slow Rewardful upstream from stalling NextAuth sign-in.
 */
export async function linkRewardfulAffiliateWithTimeout(
  args: { userId: string; email: string; name?: string | null },
  timeoutMs = 5000
) {
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), timeoutMs)
  );
  const result = await Promise.race([linkRewardfulAffiliate(args), timeout]);
  if (result === "timeout") {
    console.warn(
      `[linkRewardfulAffiliate] timed out after ${timeoutMs}ms for ${args.email}; background work continues, next sign-in will retry if needed`
    );
  }
}

/**
 * Link a user's account to their commission-system affiliate by email.
 * If no matching affiliate exists, auto-create one on the default campaign.
 *
 * Never throws — the caller (NextAuth signIn / events.createUser) must not
 * fail when the upstream service is unavailable; the next sign-in retries.
 */
export async function linkRewardfulAffiliate(args: {
  userId: string;
  email: string;
  name?: string | null;
}) {
  const { userId, email, name } = args;
  const normalizedEmail = email.toLowerCase();

  // Singleflight lock: only one concurrent link attempt per user. /api/me/
  // backfill-status polls every 15s and linkRewardfulAffiliateWithTimeout
  // returns after 5s while the background work keeps running, so without a
  // lock a slow Rewardful upstream stacks up createAffiliate calls for the
  // same email and can create duplicate affiliates upstream.
  //
  // TTL must exceed realistic worst-case upstream latency — a 30s TTL can
  // expire mid-createAffiliate and let a second poll re-enter, creating a
  // duplicate. 5 min covers very slow upstream while still self-recovering
  // after a crashed Lambda (user can't sit locked forever).
  const LOCK_TTL_MS = 5 * 60_000;
  const claim = await prisma.user.updateMany({
    where: {
      id: userId,
      rewardfulAffiliateId: null,
      OR: [
        { linkInProgressAt: null },
        { linkInProgressAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } },
      ],
    },
    data: { linkInProgressAt: new Date() },
  });
  if (claim.count === 0) {
    // Either already linked or another in-flight call holds the lock.
    return;
  }

  try {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { rewardfulAffiliateId: true },
    });
    if (current?.rewardfulAffiliateId) return;

    const existing = await rewardful.getAffiliateByEmail(email);
    if (existing) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          rewardfulAffiliateId: existing.id,
          rewardfulEmail: normalizedEmail,
          backfillStatus: "NOT_STARTED",
          linkError: null,
        },
      });
      console.log(
        `[linkRewardfulAffiliate] linked existing ${normalizedEmail} -> ${existing.id}`
      );
      return;
    }

    const campaignId = process.env.DEFAULT_REWARDFUL_CAMPAIGN_ID || undefined;
    const trimmed = (name || "").trim();
    const parts = trimmed ? trimmed.split(/\s+/) : [];
    const firstName = parts[0] || email.split("@")[0] || "Affiliate";
    // Rewardful rejects last_name:"" with a 422 even though the field is
    // optional when omitted entirely. Pass undefined (omitted) when the
    // user has no second name part (e.g. Google profiles with family-name
    // blanked).
    const lastName = parts.slice(1).join(" ") || undefined;

    const created = await rewardful.createAffiliate({
      email,
      first_name: firstName,
      last_name: lastName,
      campaign_id: campaignId,
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        rewardfulAffiliateId: created.id,
        rewardfulEmail: normalizedEmail,
        backfillStatus: "NOT_STARTED",
        linkError: null,
      },
    });

    console.log(
      `[linkRewardfulAffiliate] auto-created ${normalizedEmail} -> ${created.id}`
    );
    await notifyAdminOfAutoCreate({ newUserId: userId, email: normalizedEmail });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(
      `[linkRewardfulAffiliate] failed for ${normalizedEmail}; will retry next sign-in: ${msg}`
    );
    await prisma.user
      .update({
        where: { id: userId },
        data: { linkError: msg.slice(0, 1000) },
      })
      .catch(() => {
        // Swallow — never let link error bookkeeping fail the sign-in path.
      });
  }
}

async function notifyAdminOfAutoCreate(args: {
  newUserId: string;
  email: string;
}) {
  try {
    const where = adminUserWhereOr();
    if (!where) return;
    const admins = await prisma.user.findMany({
      where,
      select: { id: true },
    });
    if (admins.length === 0) return;
    await Promise.all(
      admins.map((admin) =>
        createNotification({
          userId: admin.id,
          type: "AFFILIATE_AUTO_CREATED",
          title: "New affiliate auto-created",
          body: `${args.email} signed in and was added to the commission system.`,
          data: { newUserId: args.newUserId, email: args.email },
        })
      )
    );
  } catch (err) {
    console.error("[linkRewardfulAffiliate] admin notification failed:", err);
  }
}
