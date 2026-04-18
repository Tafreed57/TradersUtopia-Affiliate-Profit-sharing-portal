import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { createCoupon, listCampaigns } from "@/lib/rewardful";

const approveSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
  campaign_id: z.string().optional(),
});

/**
 * POST /api/promo-codes/:id/approve
 *
 * Teacher approves or rejects a student's promo code request.
 * On approval, auto-creates the coupon via Rewardful API.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const { action, reason, campaign_id } = approveSchema.parse(body);

    // Get the promo code request
    const request = await prisma.promoCodeRequest.findUnique({
      where: { id },
      include: {
        requester: {
          select: {
            id: true,
            rewardfulAffiliateId: true,
            email: true,
          },
        },
      },
    });

    if (!request) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    const isAdmin = session.user.isAdmin;

    // Admins can retry FAILED codes; teachers can only act on PENDING_TEACHER
    const allowedStatuses = isAdmin
      ? ["PENDING_TEACHER", "FAILED"]
      : ["PENDING_TEACHER"];

    if (!allowedStatuses.includes(request.status)) {
      return NextResponse.json(
        { error: "Request has already been reviewed" },
        { status: 409 }
      );
    }

    // Verify the reviewer is a teacher of the requester
    const isTeacher = await prisma.teacherStudent.findFirst({
      where: {
        teacherId: session.user.id,
        studentId: request.requesterId,
        status: "ACTIVE",
      },
    });

    if (!isTeacher && !isAdmin) {
      return NextResponse.json(
        { error: "You are not authorized to review this request" },
        { status: 403 }
      );
    }

    if (action === "reject") {
      const updated = await prisma.promoCodeRequest.update({
        where: { id },
        data: {
          status: "REJECTED_TEACHER",
          reviewerId: session.user.id,
          rejectionReason: reason ?? null,
          reviewedAt: new Date(),
        },
      });

      await createNotification({
        userId: request.requesterId,
        type: "PROMO_CODE_REJECTED",
        title: "Promo Code Rejected",
        body: `Your promo code request "${request.proposedCode}" was rejected.${reason ? ` Reason: ${reason}` : ""}`,
        data: { promoCodeRequestId: id },
      });

      return NextResponse.json(updated);
    }

    // Approve — create coupon via Rewardful
    if (!request.requester.rewardfulAffiliateId) {
      const updated = await prisma.promoCodeRequest.update({
        where: { id },
        data: {
          status: "FAILED",
          reviewerId: session.user.id,
          reviewedAt: new Date(),
          errorMessage: "Affiliate not linked to commission system",
        },
      });
      return NextResponse.json(updated);
    }

    try {
      // Resolve campaign: use provided campaign_id or fall back to default
      const campaigns = await listCampaigns({ limit: 100 });
      if (!campaigns.data.length) {
        throw new Error("No commission plans found");
      }

      let selectedCampaign = campaign_id
        ? campaigns.data.find((c) => c.id === campaign_id)
        : campaigns.data.find((c) => c.default) ?? campaigns.data[0];

      if (!selectedCampaign) {
        throw new Error("Specified commission plan not found");
      }

      const coupon = await createCoupon({
        affiliate_id: request.requester.rewardfulAffiliateId,
        campaign_id: selectedCampaign.id,
        code: request.proposedCode,
      });

      const updated = await prisma.promoCodeRequest.update({
        where: { id },
        data: {
          status: "CREATED",
          reviewerId: session.user.id,
          reviewedAt: new Date(),
          rewardfulCouponId: coupon.id,
          campaignId: selectedCampaign.id,
          campaignName: selectedCampaign.name,
        },
      });

      await createNotification({
        userId: request.requesterId,
        type: "PROMO_CODE_APPROVED",
        title: "Promo Code Approved!",
        body: `Your promo code "${request.proposedCode}" has been approved and is now active.`,
        data: { promoCodeRequestId: id },
      });

      return NextResponse.json(updated);
    } catch (apiError) {
      const errorMessage =
        apiError instanceof Error ? apiError.message : "Unknown error";

      await prisma.promoCodeRequest.update({
        where: { id },
        data: {
          status: "FAILED",
          reviewerId: session.user.id,
          reviewedAt: new Date(),
          errorMessage,
        },
      });

      return NextResponse.json(
        { error: `Failed to create code: ${errorMessage}` },
        { status: 422 }
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Promo code approval error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
