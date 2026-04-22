import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

const tokenSchema = z.object({
  token: z.string().min(1),
  platform: z.string().optional(),
  deviceId: z.string().min(1).optional(),
  userAgent: z.string().min(1).max(1000).optional(),
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
    const { token, platform, deviceId, userAgent } = tokenSchema.parse(body);
    const normalizedPlatform = platform ?? "web";

    if (!deviceId) {
      await prisma.deviceToken.upsert({
        where: { token },
        create: {
          userId: session.user.id,
          token,
          platform: normalizedPlatform,
          userAgent: userAgent ?? null,
        },
        update: {
          userId: session.user.id,
          platform: normalizedPlatform,
          userAgent: userAgent ?? null,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({ success: true, mode: "legacy" });
    }

    const registration = await prisma.$transaction(async (tx) => {
      await tx.deviceToken.deleteMany({
        where: {
          token,
          NOT: {
            userId: session.user.id,
            deviceId,
          },
        },
      });

      const current = await tx.deviceToken.upsert({
        where: {
          userId_deviceId: {
            userId: session.user.id,
            deviceId,
          },
        },
        create: {
          userId: session.user.id,
          token,
          deviceId,
          userAgent: userAgent ?? null,
          platform: normalizedPlatform,
        },
        update: {
          token,
          userAgent: userAgent ?? null,
          platform: normalizedPlatform,
          updatedAt: new Date(),
        },
      });

      // Automatically retire legacy token rows from the pre-deviceId era for
      // this user/platform. Other active devices will re-register themselves
      // the next time that installation opens the app.
      await tx.deviceToken.deleteMany({
        where: {
          userId: session.user.id,
          platform: normalizedPlatform,
          deviceId: null,
          id: { not: current.id },
        },
      });

      return current;
    });

    return NextResponse.json({
      success: true,
      mode: "device",
      deviceId: registration.deviceId,
    });
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
