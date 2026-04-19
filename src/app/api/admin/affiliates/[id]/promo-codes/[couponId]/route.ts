import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

/**
 * DELETE /api/admin/affiliates/:id/promo-codes/:couponId
 *
 * Removes a coupon upstream and marks any matching local
 * PromoCodeRequest row as REJECTED so the audit trail reflects the
 * removal. couponId is the upstream Rewardful coupon id, not the
 * local PromoCodeRequest id.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; couponId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, couponId } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { rewardfulAffiliateId: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!user.rewardfulAffiliateId) {
    return NextResponse.json(
      { error: "Affiliate has no upstream link yet" },
      { status: 409 }
    );
  }

  // Ownership check — verify the coupon actually belongs to this
  // affiliate before deleting. Prevents a stale or manually-constructed
  // request from deleting another affiliate's code via this scoped URL.
  // Uses the paginated list rather than a direct GET because the free
  // endpoint doesn't expose a /coupons/:id lookup; at realistic scales
  // (dozens of coupons per affiliate) this is cheap.
  try {
    const coupons = await rewardful.listAllCouponsForAffiliate(
      user.rewardfulAffiliateId
    );
    const owned = coupons.some((c) => c.id === couponId);
    if (!owned) {
      return NextResponse.json(
        { error: "Coupon does not belong to this affiliate" },
        { status: 404 }
      );
    }
  } catch (err) {
    if (err instanceof rewardful.RewardfulApiError && err.status === 404) {
      // Affiliate no longer exists upstream → no coupons → coupon in
      // URL cannot belong to them. 404 the delete attempt rather than
      // silently proceeding.
      return NextResponse.json(
        { error: "Coupon does not belong to this affiliate" },
        { status: 404 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin promo-codes] ownership check failed:`, msg);
    return NextResponse.json(
      { error: "Failed to verify coupon ownership" },
      { status: 502 }
    );
  }

  try {
    await rewardful.deleteCoupon(couponId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin promo-codes] delete failed for ${couponId}:`, msg);
    return NextResponse.json(
      { error: `Upstream rejected: ${msg}` },
      { status: 502 }
    );
  }

  // Mark any local request row that tracked this coupon as rejected
  // (REJECTED_TEACHER is the closest terminal non-CREATED state in the
  // existing enum — REJECTED-by-admin post-creation is a new vector).
  // Harmless if no match (auto-created codes won't have a local row).
  await prisma.promoCodeRequest.updateMany({
    where: { rewardfulCouponId: couponId },
    data: {
      status: "REJECTED_TEACHER",
      rejectionReason: "Removed by admin",
      reviewedAt: new Date(),
      reviewerId: session.user.id,
    },
  });

  return NextResponse.json({ ok: true, deleted: couponId });
}
