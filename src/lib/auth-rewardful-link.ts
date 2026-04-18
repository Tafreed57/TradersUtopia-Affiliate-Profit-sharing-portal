import { ADMIN_EMAIL } from "@/lib/constants";
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
    const lastName = parts.slice(1).join(" ") || "";

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
      },
    });

    console.log(
      `[linkRewardfulAffiliate] auto-created ${normalizedEmail} -> ${created.id}`
    );
    await notifyAdminOfAutoCreate({ newUserId: userId, email: normalizedEmail });
  } catch (err) {
    console.error(
      `[linkRewardfulAffiliate] failed for ${normalizedEmail}; will retry next sign-in:`,
      err
    );
  }
}

async function notifyAdminOfAutoCreate(args: {
  newUserId: string;
  email: string;
}) {
  try {
    const adminEmail = ADMIN_EMAIL.toLowerCase();
    if (!adminEmail) return;
    const admin = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    if (!admin) return;
    await createNotification({
      userId: admin.id,
      type: "AFFILIATE_AUTO_CREATED",
      title: "New affiliate auto-created",
      body: `${args.email} signed in and was added to the commission system.`,
      data: { newUserId: args.newUserId, email: args.email },
    });
  } catch (err) {
    console.error("[linkRewardfulAffiliate] admin notification failed:", err);
  }
}
