import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/notifications/test
 *
 * Admin-only. Sends a real notification to the signed-in admin's own account
 * so push delivery can be verified without waiting for a business event.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin || !session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const deviceTokenCount = await prisma.deviceToken.count({
      where: { userId: session.user.id },
    });

    const timestamp = new Date().toLocaleString("en-CA", {
      dateStyle: "medium",
      timeStyle: "medium",
    });

    const notification = await createNotification({
      userId: session.user.id,
      type: "TEST_NOTIFICATION",
      title: "Test Notification",
      body:
        "This is a test alert from the admin panel. If you received this as a push, device registration and delivery are working.",
      data: {
        href: "/notifications",
        triggeredAt: timestamp,
        deviceTokenCount,
      },
    });

    const persisted = await prisma.notification.findUnique({
      where: { id: notification.id },
      select: {
        id: true,
        pushStatus: true,
        pushError: true,
        sentPush: true,
      },
    });

    return NextResponse.json({
      ok: true,
      notificationId: notification.id,
      deviceTokenCount,
      pushStatus: persisted?.pushStatus ?? "PENDING",
      pushError: persisted?.pushError ?? null,
      sentPush: persisted?.sentPush ?? false,
    });
  } catch (error) {
    console.error("[admin-test-notification] failed:", error);
    return NextResponse.json(
      { error: "Failed to send test notification" },
      { status: 500 }
    );
  }
}
