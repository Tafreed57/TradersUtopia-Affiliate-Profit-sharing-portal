import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { deleteOwnedPromoCode, PromoCodeConflict } from "@/lib/promo-code-service";
import * as rewardful from "@/lib/rewardful";

/** Deletes an owned coupon with the same durable lease used by creation. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; couponId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, couponId } = await params;
  const user = await prisma.user.findUnique({
    where: { id }, select: { rewardfulAffiliateId: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!user.rewardfulAffiliateId) {
    return NextResponse.json({ error: "Affiliate has no upstream link yet" }, { status: 409 });
  }

  try {
    let coupons: rewardful.RewardfulCoupon[] = [];
    try {
      coupons = await rewardful.listAllCouponsForAffiliate(user.rewardfulAffiliateId);
    } catch (error) {
      if (!(error instanceof rewardful.RewardfulApiError && error.status === 404)) throw error;
    }
    const owned = coupons.find((coupon) => coupon.id === couponId);
    // The provider may already have deleted it before a prior request lost its
    // response. Creation/deletion records contain a durable owner for that retry.
    const recorded = owned ? null : await prisma.promoCodeRequest.findFirst({
      where: { requesterId: id, rewardfulCouponId: couponId },
      select: { proposedCode: true },
    });
    if (!owned && !recorded) {
      return NextResponse.json({ error: "Coupon does not belong to this affiliate" }, { status: 404 });
    }
    await deleteOwnedPromoCode({
      requesterId: id, reviewerId: session.user.id, couponId,
      code: owned ? rewardful.couponCode(owned) : recorded!.proposedCode,
      reconcileUnlinkedRequest: !!owned && owned.archived !== true,
      // A historical local ID proves only local ownership: after an affiliate
      // relink it might belong to another upstream account. Never issue a
      // provider DELETE unless the current affiliate's list verified it.
      providerAlreadyAbsent: !owned,
    });
    return NextResponse.json({ ok: true, deleted: couponId });
  } catch (error) {
    if (error instanceof PromoCodeConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(`[admin promo-codes] delete failed for ${couponId}:`, error);
    return NextResponse.json({ error: "Code removal could not be completed. Try again." }, { status: 502 });
  }
}
