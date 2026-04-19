import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import {
  PROMO_CODE_MAX_LENGTH,
  PROMO_CODE_MIN_LENGTH,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";
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
        leads: c.leads ?? 0,
        conversions: c.conversions ?? 0,
        createdAt: c.created_at,
      })),
    });
  } catch (err) {
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
 * Admin-created promo code. Bypasses the affiliate-request→teacher-approval
 * flow — admin-created codes are immediately active at Rewardful.
 *
 * Body: { code: string, campaignId: string }
 */
const createSchema = z.object({
  code: z
    .string()
    .min(PROMO_CODE_MIN_LENGTH)
    .max(PROMO_CODE_MAX_LENGTH)
    .regex(/^[A-Za-z0-9]+$/, "Code must contain only letters and digits"),
  campaignId: z.string().min(1, "Campaign is required"),
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

  // Mirror the approval-path guard: a campaign without a Stripe coupon
  // can't actually discount at checkout, so the code would be silently
  // inert and commissions wouldn't track. Block up-front. Also resolves
  // the campaign name up-front so the local audit row is populated even
  // if Rewardful's create response omits the expanded campaign object.
  let resolvedCampaignName: string | null = null;
  try {
    const campaigns = await rewardful.listCampaigns({ limit: 100 });
    const campaign = campaigns.data.find((c) => c.id === body.campaignId);
    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }
    if (!campaign.stripe_coupon_id) {
      return NextResponse.json(
        {
          error:
            "Campaign has no Stripe coupon configured. Configure it in the upstream campaign settings before creating a promo code.",
        },
        { status: 422 }
      );
    }
    resolvedCampaignName = campaign.name;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin promo-codes] campaign check failed:`, msg);
    return NextResponse.json(
      { error: "Failed to verify campaign" },
      { status: 502 }
    );
  }

  try {
    const created = await rewardful.createCoupon({
      affiliate_id: user.rewardfulAffiliateId,
      campaign_id: body.campaignId,
      code: normalizedCode,
    });

    // Record locally as a CREATED request with the admin as reviewer so
    // the audit trail stays consistent. The admin-direct path sets
    // reviewerId = admin who ran it. Falls back to the resolved
    // campaign name if Rewardful's create response didn't expand it.
    await prisma.promoCodeRequest.create({
      data: {
        requesterId: id,
        reviewerId: session.user.id,
        proposedCode: normalizedCode,
        status: "CREATED",
        rewardfulCouponId: created.id,
        campaignId: body.campaignId,
        campaignName: created.campaign?.name ?? resolvedCampaignName,
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
    return NextResponse.json(
      { error: `Upstream rejected: ${msg}` },
      { status: 502 }
    );
  }
}
