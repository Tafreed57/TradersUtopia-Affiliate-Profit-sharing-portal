import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import {
  PROMO_CODE_MAX_LENGTH,
  PROMO_CODE_MIN_LENGTH,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { formatPromoCodeCreationError } from "@/lib/promo-code-campaign";
import * as rewardful from "@/lib/rewardful";

/**
 * GET /api/admin/affiliates/:id/promo-codes
 *
 * Lists all coupons attached to this affiliate upstream. Includes any
 * auto-created codes so admin can delete them if unwanted.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      rewardfulAffiliateId: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!user.rewardfulAffiliateId) {
    return NextResponse.json({ coupons: [] });
  }

  try {
    const coupons = await rewardful.listAllCouponsForAffiliate(
      user.rewardfulAffiliateId
    );
    return NextResponse.json({
      coupons: coupons.map((c) => ({
        id: c.id,
        code: rewardful.couponCode(c),
        campaignId: c.campaign?.id ?? null,
        campaignName: c.campaign?.name ?? null,
        archived: c.archived ?? false,
        archivedAt: c.archived_at ?? null,
        leads: c.leads ?? 0,
        conversions: c.conversions ?? 0,
        createdAt: c.created_at,
      })),
    });
  } catch (err) {
    // 404: the stored rewardfulAffiliateId no longer exists upstream
    // (test fixture, cleared campaign, manual deletion in Rewardful
    // dashboard). Treat as "no coupons" and render the empty state
    // instead of bubbling a 502 to the admin UI.
    if (err instanceof rewardful.RewardfulApiError && err.status === 404) {
      return NextResponse.json({ coupons: [] });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin promo-codes] list failed for ${id}:`, msg);
    return NextResponse.json(
      { error: "Failed to fetch promo codes" },
      { status: 502 }
    );
  }
}

/**
 * POST /api/admin/affiliates/:id/promo-codes
 *
 * Admin-created promo code. Bypasses the affiliate request / teacher approval
 * flow. Admin-created codes are immediately active upstream.
 *
 * Body: { code: string }
 */
const createSchema = z.object({
  code: z
    .string()
    .min(PROMO_CODE_MIN_LENGTH)
    .max(PROMO_CODE_MAX_LENGTH)
    .regex(/^[A-Za-z0-9]+$/, "Code must contain only letters and digits"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, rewardfulAffiliateId: true },
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

  const normalizedCode = body.code.toUpperCase();

  // Mirror the public request-flow uniqueness guard: if the code is
  // already reserved (pending, approved, or created) for ANY affiliate,
  // admin creation would collide with it at Rewardful and doom the
  // other request. Block early with a clear message.
  const conflict = await prisma.promoCodeRequest.findFirst({
    where: {
      proposedCode: normalizedCode,
      status: { in: ["PENDING_TEACHER", "APPROVED_TEACHER", "CREATED"] },
    },
    select: { id: true, requesterId: true, status: true },
  });
  if (conflict) {
    return NextResponse.json(
      {
        error: `Code "${normalizedCode}" is already reserved (status: ${conflict.status}). Resolve the existing request before creating.`,
      },
      { status: 409 }
    );
  }

  try {
    const existingCoupons = await rewardful.listAllCouponsForAffiliate(
      user.rewardfulAffiliateId
    );
    const existingActiveCoupon = existingCoupons.find(
      (coupon) =>
        coupon.archived !== true &&
        rewardful.couponCode(coupon).toUpperCase() === normalizedCode
    );

    if (existingActiveCoupon) {
      return NextResponse.json(
        { error: `Code "${normalizedCode}" already exists for this affiliate.` },
        { status: 409 }
      );
    }

    const created = await rewardful.createCoupon({
      affiliate_id: user.rewardfulAffiliateId,
      code: normalizedCode,
    });

    // Record locally as a CREATED request with the admin as reviewer so
    // the audit trail stays consistent. The admin-direct path sets
    // reviewerId = admin who ran it.
    await prisma.promoCodeRequest.create({
      data: {
        requesterId: id,
        reviewerId: session.user.id,
        proposedCode: normalizedCode,
        status: "CREATED",
        rewardfulCouponId: created.id,
        campaignId: created.campaign?.id ?? null,
        campaignName: created.campaign?.name ?? null,
        reviewedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      coupon: {
        id: created.id,
        code: created.token,
        campaignId: created.campaign?.id ?? null,
        campaignName: created.campaign?.name ?? null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin promo-codes] create failed for ${id}:`, msg);
    const errorMessage = formatPromoCodeCreationError(err);
    return NextResponse.json(
      { error: errorMessage },
      { status: 502 }
    );
  }
}
