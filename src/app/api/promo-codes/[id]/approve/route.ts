import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { createCoupon, listCampaigns } from "@/lib/rewardful";

const approveSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
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
    const { action, reason } = approveSchema.parse(body);

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

    if (request.status !== "PENDING_TEACHER") {
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
        isActive: true,
      },
    });

    // Also allow admin to approve
    const isAdmin = session.user.isAdmin;

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
      // Get the first campaign to associate the coupon with
      const campaigns = await listCampaigns({ limit: 1 });
      if (!campaigns.data.length) {
        throw new Error("No campaigns found");
      }

      const coupon = await createCoupon({
        affiliate_id: request.requester.rewardfulAffiliateId,
        campaign_id: campaigns.data[0].id,
        code: request.proposedCode,
      });

      const updated = await prisma.promoCodeRequest.update({
        where: { id },
        data: {
          status: "CREATED",
          reviewerId: session.user.id,
          reviewedAt: new Date(),
          rewardfulCouponId: coupon.id,
        },
      });

      return NextResponse.json(updated);
    } catch (apiError) {
      const errorMessage =
        apiError instanceof Error ? apiError.message : "Unknown error";

      const updated = await prisma.promoCodeRequest.update({
        where: { id },
        data: {
          status: "FAILED",
          reviewerId: session.user.id,
          reviewedAt: new Date(),
          errorMessage,
        },
      });

      return NextResponse.json(updated);
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
