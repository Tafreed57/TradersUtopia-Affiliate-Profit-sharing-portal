import type { NotificationType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Create an in-app notification record and attempt to send a push notification
 * to all registered devices for the user.
 */
export async function createNotification({
  userId,
  type,
  title,
  body,
  data,
}: CreateNotificationParams) {
  // Create the in-app notification record
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      data: (data as Prisma.InputJsonValue) ?? undefined,
    },
  });

  // Send push notification in the background — don't block the caller
  sendPush(userId, title, body, data).catch((err) => {
    console.error(`Push notification failed for user ${userId}:`, err);
  });

  return notification;
}

/**
 * Send push notification to all registered devices for a user.
 * Cleans up invalid tokens automatically.
 */
async function sendPush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const tokens = await prisma.deviceToken.findMany({
    where: { userId },
    select: { id: true, token: true },
  });

  if (tokens.length === 0) return;

  // Lazy-import firebase-admin to avoid initialization errors when
  // Firebase credentials are not configured (e.g., in tests)
  const { messaging } = await import("@/lib/firebase-admin");

  const message = {
    notification: { title, body },
    data: data
      ? Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        )
      : undefined,
    webpush: {
      fcmOptions: { link: "/" },
    },
  };

  const staleTokenIds: string[] = [];

  // Send to each token individually so we can track which ones fail
  await Promise.allSettled(
    tokens.map(async ({ id, token }) => {
      try {
        await messaging.send({ ...message, token });

        // Mark notification as sent
        await prisma.notification
          .updateMany({
            where: { userId, sentPush: false },
            data: { sentPush: true },
          })
          .catch(() => {});
      } catch (err: unknown) {
        const error = err as { code?: string };
        // Remove invalid/expired tokens
        if (
          error.code === "messaging/invalid-registration-token" ||
          error.code === "messaging/registration-token-not-registered"
        ) {
          staleTokenIds.push(id);
        }
      }
    })
  );

  // Clean up stale tokens
  if (staleTokenIds.length > 0) {
    await prisma.deviceToken.deleteMany({
      where: { id: { in: staleTokenIds } },
    });
  }
}

/**
 * Send notifications to multiple users at once (e.g., conversion event
 * notifying affiliate + teachers).
 */
export async function createNotifications(
  notifications: CreateNotificationParams[]
) {
  return Promise.allSettled(
    notifications.map((n) => createNotification(n))
  );
}
