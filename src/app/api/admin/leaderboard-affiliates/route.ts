import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import {
  getLeaderboardVisibilityRows,
  updateLeaderboardVisibility,
} from "@/lib/company-performance-service";

const updateSchema = z.object({
  affiliateId: z.string().min(1),
  visible: z.boolean(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await getLeaderboardVisibilityRows();
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("[admin-leaderboard-affiliates] list failed:", error);
    return NextResponse.json(
      { error: "Leaderboard settings are temporarily unavailable" },
      { status: 503 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin || !session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = updateSchema.parse(await req.json());
    const row = await updateLeaderboardVisibility({
      affiliateId: body.affiliateId,
      visible: body.visible,
      updatedById: session.user.id,
    });

    return NextResponse.json({
      affiliateId: row.affiliateId,
      displayName: row.displayName,
      email: row.affiliateEmail,
      visible: row.visible,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }

    console.error("[admin-leaderboard-affiliates] update failed:", error);
    return NextResponse.json(
      { error: "Failed to update leaderboard settings" },
      { status: 500 }
    );
  }
}

