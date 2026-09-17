import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { createReservedPromoCode, PromoCodeConflict, rejectReservedPromoCode } from "@/lib/promo-code-service";

const approveSchema = z.object({ action: z.enum(["approve", "reject"]), reason: z.string().max(500).optional() });

/** Teachers review regular affiliates; administrators can also retry failed creation. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const { action, reason } = approveSchema.parse(await req.json());
    const [reviewer, request] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.user.id }, select: { accountType: true, status: true } }),
      prisma.promoCodeRequest.findUnique({
        where: { id },
        include: { requester: { select: { rewardfulAffiliateId: true, accountType: true, status: true } } },
      }),
    ]);
    const isAdmin = session.user.isAdmin;
    if (!reviewer || reviewer.status !== "ACTIVE" || (!isAdmin && reviewer.accountType === "WORK")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (request.requester.status !== "ACTIVE") return NextResponse.json({ error: "Account is unavailable" }, { status: 409 });
    const isWork = request.requester.accountType === "WORK";
    const isTeacher = !isWork && await prisma.teacherStudent.findFirst({
      where: { teacherId: session.user.id, studentId: request.requesterId, status: "ACTIVE" },
    });
    if (!isAdmin && !isTeacher) return NextResponse.json({ error: "You are not authorized to review this request" }, { status: 403 });

    const canRetryCreating = request.status === "CREATING" && (isAdmin || request.reviewerId === session.user.id);
    if (request.status !== "PENDING_TEACHER" && !(isAdmin && request.status === "FAILED") && !canRetryCreating) {
      return NextResponse.json({ error: "Request has already been reviewed" }, { status: 409 });
    }
    if (action === "reject") {
      const updated = await rejectReservedPromoCode({ requestId: id, reviewerId: session.user.id, reason: reason ?? null });
      await createNotification({
        userId: request.requesterId, dedupeKey: `promo-rejected:${id}`,
        type: "PROMO_CODE_REJECTED", title: "Promo Code Rejected",
        body: `Your promo code request "${request.proposedCode}" was rejected.${reason ? ` Reason: ${reason}` : ""}`,
        data: { promoCodeRequestId: id },
      });
      return NextResponse.json(updated);
    }
    if (!request.requester.rewardfulAffiliateId) {
      return NextResponse.json({ error: "This account is getting ready. Try again shortly." }, { status: 409 });
    }
    const outcome = await createReservedPromoCode({
      request, affiliateId: request.requester.rewardfulAffiliateId, reviewerId: session.user.id,
    });
    if (outcome.result === "unavailable") return NextResponse.json({ error: "This code is unavailable. Try a different code." }, { status: 409 });
    if (outcome.result === "failed") return NextResponse.json({ error: outcome.request.errorMessage }, { status: 422 });
    if (outcome.result === "created") {
      await createNotification({
        userId: request.requesterId, dedupeKey: `promo-active:${id}`,
        type: "PROMO_CODE_APPROVED", title: isWork ? "Promo Code Active" : "Promo Code Approved!",
        body: isWork ? `Your promo code "${request.proposedCode}" is now active.` : `Your promo code "${request.proposedCode}" has been approved and is now active.`,
        data: { promoCodeRequestId: id },
      }).catch((error) => console.error("Promo activation notification failed:", error));
    }
    return NextResponse.json(outcome.request, { status: outcome.result === "busy" ? 202 : 200 });
  } catch (error) {
    if (error instanceof PromoCodeConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    console.error("Promo code approval error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
