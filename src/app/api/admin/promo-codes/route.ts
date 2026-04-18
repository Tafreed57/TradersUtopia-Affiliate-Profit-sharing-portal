import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = [
  "PENDING_TEACHER",
  "APPROVED_TEACHER",
  "REJECTED_TEACHER",
  "CREATED",
  "FAILED",
] as const;

type ValidStatus = (typeof VALID_STATUSES)[number];

/**
 * GET /api/admin/promo-codes
 *
 * Admin-only. Returns all promo code requests across all affiliates.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get("status");

  if (rawStatus && !VALID_STATUSES.includes(rawStatus as ValidStatus)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const status = rawStatus as ValidStatus | null;

  try {
    const requests = await prisma.promoCodeRequest.findMany({
      where: status ? { status } : {},
      include: {
        requester: { select: { id: true, name: true, email: true } },
        reviewer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: requests });
  } catch (error) {
    console.error("Failed to fetch promo code requests:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
