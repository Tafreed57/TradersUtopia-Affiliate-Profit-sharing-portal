import * as rewardful from "./rewardful.ts";
import type { RewardfulCoupon } from "./rewardful.ts";

type CleanupCoupon = Pick<
  RewardfulCoupon,
  "id" | "token" | "code" | "leads" | "conversions"
>;

function normalizeToken(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function couponToken(coupon: CleanupCoupon) {
  return normalizeToken(coupon.token ?? coupon.code ?? "");
}

function hasTrackedActivity(coupon: CleanupCoupon) {
  return Number(coupon.leads ?? 0) > 0 || Number(coupon.conversions ?? 0) > 0;
}

export function signupCouponTokenCandidates(args: {
  firstName: string;
  email: string;
}) {
  const candidates = [
    normalizeToken(args.firstName),
    normalizeToken(args.email.split("@")[0] ?? ""),
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

export function findLikelySignupAutoCoupons(args: {
  firstName: string;
  email: string;
  coupons: CleanupCoupon[];
}) {
  const candidateTokens = signupCouponTokenCandidates(args);

  return args.coupons.filter((coupon) => {
    if (hasTrackedActivity(coupon)) return false;

    const token = couponToken(coupon);
    return candidateTokens.some((candidate) => {
      if (token === candidate) return true;
      return token.startsWith(candidate) && /^\d+$/.test(token.slice(candidate.length));
    });
  });
}

export async function removeSignupAutoCouponsBestEffort(args: {
  affiliateId: string;
  firstName: string;
  email: string;
  attempts?: number;
  delayMs?: number;
}) {
  const attempts = args.attempts ?? 2;
  const delayMs = args.delayMs ?? 750;
  const deleted: string[] = [];

  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const coupons = await rewardful.listAllCouponsForAffiliate(args.affiliateId);
      const candidates = findLikelySignupAutoCoupons({
        firstName: args.firstName,
        email: args.email,
        coupons,
      });

      if (candidates.length > 0) {
        for (const coupon of candidates) {
          try {
            await rewardful.deleteCoupon(coupon.id);
            deleted.push(coupon.id);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(
              `[signup-coupon-cleanup] failed to delete startup coupon ${coupon.id}: ${msg}`
            );
          }
        }
        return { deleted, failed: false };
      }

      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }

    return { deleted, failed: false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `[signup-coupon-cleanup] failed for affiliate ${args.affiliateId}: ${msg}`
    );
    return { deleted, failed: true };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
