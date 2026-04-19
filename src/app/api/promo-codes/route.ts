import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { PROMO_CODE_MAX_LENGTH, PROMO_CODE_MIN_LENGTH } from "@/lib/constants";
import { createNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

const requestSchema = z.object({
  proposedCode: z
    .string()
    .min(PROMO_CODE_MIN_LENGTH)
    .max(PROMO_CODE_MAX_LENGTH)
    .regex(/^[A-Za-z]+$/, "Code must contain only letters"),
});

/**
 * POST /api/promo-codes
 *
 * Affiliate requests a promo code. Goes to their teacher for approval.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { proposedCode } = requestSchema.parse(body);
    const normalizedCode = proposedCode.toUpperCase();

    // Check for duplicate pending/created codes
    const existing = await prisma.promoCodeRequest.findFirst({
      where: {
        proposedCode: normalizedCode,
        status: { in: ["PENDING_TEACHER", "APPROVED_TEACHER", "CREATED"] },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "This code is already in use or pending approval" },
        { status: 409 }
      );
    }

    const request = await prisma.promoCodeRequest.create({
      data: {
        requesterId: session.user.id,
        proposedCode: normalizedCode,
        status: "PENDING_TEACHER",
      },
    });

    // Notify all teachers about the promo code request
    const teachers = await prisma.teacherStudent.findMany({
      where: { studentId: session.user.id, status: "ACTIVE", depth: 1 },
      select: { teacherId: true },
    });

    const requesterName = session.user.name || session.user.email || "A student";

    if (teachers.length > 0) {
      await createNotifications(
        teachers.map((t) => ({
          userId: t.teacherId,
          type: "PROMO_CODE_REQUEST_RECEIVED" as const,
          title: "Promo Code Request",
          body: `${requesterName} requested promo code "${normalizedCode}". Review it now.`,
          data: { promoCodeRequestId: request.id },
        }))
      );
    }

    return NextResponse.json(request, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Promo code request error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/promo-codes
 *
 * Returns promo code requests for the authenticated user.
 * Teachers also see requests from their students.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Load user's upstream affiliate id so we can fetch existing coupons.
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { rewardfulAffiliateId: true },
  });

  // Get user's own requests
  const myRequests = await prisma.promoCodeRequest.findMany({
    where: { requesterId: userId },
    include: {
      reviewer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Get requests from students (if user is a teacher)
  const studentIds = await prisma.teacherStudent.findMany({
    where: { teacherId: userId, status: "ACTIVE", depth: 1 },
    select: { studentId: true },
  });

  const studentRequests =
    studentIds.length > 0
      ? await prisma.promoCodeRequest.findMany({
          where: {
            requesterId: { in: studentIds.map((s) => s.studentId) },
            status: "PENDING_TEACHER",
          },
          include: {
            requester: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  // Fetch the user's active coupons upstream. Any auto-created codes
  // show up here even if no local PromoCodeRequest row exists. Best-
  // effort: upstream failure must not 500 the page.
  type ActiveCoupon = {
    id: string;
    code: string;
    campaignName: string | null;
    createdAt: string | null;
  };
  let activeCoupons: ActiveCoupon[] = [];
  if (me?.rewardfulAffiliateId) {
    try {
      const coupons = await rewardful.listAllCouponsForAffiliate(
        me.rewardfulAffiliateId
      );
      activeCoupons = coupons.map((c) => ({
        id: c.id,
        code: rewardful.couponCode(c),
        campaignName: c.campaign?.name ?? null,
        createdAt: c.created_at ?? null,
      }));
    } catch (err) {
      // 404: stored rewardfulAffiliateId no longer exists upstream (test
      // fixture, cleared campaign, manual deletion). Same handling as
      // the admin route — treat as "no coupons" without logging noise.
      if (
        err instanceof rewardful.RewardfulApiError &&
        err.status === 404
      ) {
        // leave activeCoupons as []
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[promo-codes] upstream list failed for ${userId}:`, msg);
      }
    }
  }

  return NextResponse.json({
    myRequests,
    pendingApprovals: studentRequests,
    activeCoupons,
  });
}
