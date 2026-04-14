import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

const tokenSchema = z.object({
  token: z.string().min(1),
  platform: z.string().optional(),
});

/**
 * POST /api/notifications/register-token
 *
 * Registers an FCM device token for the authenticated user.
 * Upserts — if the token already exists, updates the timestamp.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { token, platform } = tokenSchema.parse(body);

    await prisma.deviceToken.upsert({
      where: { token },
      create: {
        userId: session.user.id,
        token,
        platform: platform ?? "web",
      },
      update: {
        userId: session.user.id,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Token registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
