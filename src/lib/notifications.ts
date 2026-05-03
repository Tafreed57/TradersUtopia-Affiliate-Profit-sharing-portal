import * as Sentry from "@sentry/nextjs";
import type {
  NotificationType,
  Prisma,
  PushStatus,
} from "@prisma/client";

import { sanitizeNotificationCopy } from "@/lib/notification-privacy";
import { resolveNotificationHref } from "@/lib/notification-links";
import { prisma } from "@/lib/prisma";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface PushAttemptResult {
  sentPush: boolean;
  pushStatus: PushStatus;
  pushError: string | null;
}

function truncatePushError(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.slice(0, 1000);
}

function normalizeNotificationData(
  type: NotificationType,
  data?: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(data ?? {}),
    href: resolveNotificationHref(type, data),
  };
}

function formatPushError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const maybeCode =
      "code" in error && typeof error.code === "string" ? error.code : null;
    const maybeMessage =
      "message" in error && typeof error.message === "string"
        ? error.message
        : null;
    const pieces = [maybeCode, maybeMessage].filter(Boolean);
    if (pieces.length > 0) {
      return pieces.join(": ");
    }
  }
  return String(error);
}

/**
 * Create an in-app notification record and attempt to send push delivery for
 * that exact record. Push failures should never break the caller's main flow,
 * but they should be persisted for audit/debug instead of failing silently.
 */
export async function createNotification({
  userId,
  type,
  title,
  body,
  data,
}: CreateNotificationParams) {
  const notificationData = normalizeNotificationData(type, data);
  const copy = sanitizeNotificationCopy(type, title, body);

  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title: copy.title,
      body: copy.body,
      data: notificationData as Prisma.InputJsonValue,
    },
  });

  let pushResult: PushAttemptResult;
  try {
    pushResult = await sendPush(
      notification.id,
      userId,
      copy.title,
      copy.body,
      notificationData
    );
  } catch (error) {
    console.error(
      `[notifications] push delivery failed for notification ${notification.id}:`,
      error
    );
    Sentry.captureException(error, {
      tags: { subsystem: "notifications", stage: "push-delivery" },
      extra: { notificationId: notification.id, userId, type },
    });
    pushResult = {
      sentPush: false,
      pushStatus: "FAILED",
      pushError: truncatePushError(formatPushError(error)),
    };
  }

  try {
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        sentPush: pushResult.sentPush,
        pushStatus: pushResult.pushStatus,
        pushError: pushResult.pushError,
      },
    });
  } catch (error) {
    console.error(
      `[notifications] failed to persist push result for notification ${notification.id}:`,
      error
    );
    Sentry.captureException(error, {
      tags: { subsystem: "notifications", stage: "push-status-persist" },
      extra: {
        notificationId: notification.id,
        userId,
        type,
        pushStatus: pushResult.pushStatus,
      },
    });
  }

  return notification;
}

/**
 * Send push notification to all registered devices for a user.
 * Invalid tokens are removed automatically.
 */
async function sendPush(
  notificationId: string,
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<PushAttemptResult> {
  const tokens = await prisma.deviceToken.findMany({
    where: { userId },
    select: { id: true, token: true },
  });

  if (tokens.length === 0) {
    return {
      sentPush: false,
      pushStatus: "SKIPPED_NO_TOKEN",
      pushError: null,
    };
  }

  const firebaseAdminModule = await import("@/lib/firebase-admin");
  const getMessagingFn =
    typeof firebaseAdminModule.getMessaging === "function"
      ? firebaseAdminModule.getMessaging
      : typeof firebaseAdminModule.default?.getMessaging === "function"
        ? firebaseAdminModule.default.getMessaging
        : null;

  if (!getMessagingFn) {
    return {
      sentPush: false,
      pushStatus: "FAILED",
      pushError: "Push messaging helper is unavailable in this runtime.",
    };
  }

  const messaging = getMessagingFn();
  if (!messaging) {
    return {
      sentPush: false,
      pushStatus: "SKIPPED_NO_MESSAGING",
      pushError: null,
    };
  }

  const href =
    typeof data?.href === "string" && data.href.startsWith("/")
      ? data.href
      : "/notifications";

  const message = {
    notification: { title, body },
    data: data
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
      : undefined,
    webpush: {
      fcmOptions: { link: href },
    },
  };

  const staleTokenIds: string[] = [];
  const failureMessages: string[] = [];
  let deliveredCount = 0;

  await Promise.allSettled(
    tokens.map(async ({ id, token }) => {
      try {
        await messaging.send({ ...message, token });
        deliveredCount += 1;
      } catch (error: unknown) {
        const formattedError = formatPushError(error);
        failureMessages.push(formattedError);

        const errorCode =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : null;

        if (
          errorCode === "messaging/invalid-registration-token" ||
          errorCode === "messaging/registration-token-not-registered"
        ) {
          staleTokenIds.push(id);
        }
      }
    })
  );

  if (staleTokenIds.length > 0) {
    await prisma.deviceToken.deleteMany({
      where: { id: { in: staleTokenIds } },
    });
  }

  if (deliveredCount === 0) {
    return {
      sentPush: false,
      pushStatus: "FAILED",
      pushError: truncatePushError(
        failureMessages[0] ?? "Push delivery failed for every registered device."
      ),
    };
  }

  const partialFailure =
    failureMessages.length > 0
      ? `Delivered to ${deliveredCount} of ${tokens.length} devices. First failure: ${failureMessages[0]}`
      : null;

  if (partialFailure) {
    console.warn(
      `[notifications] partial push delivery for notification ${notificationId}: ${partialFailure}`
    );
  }

  return {
    sentPush: true,
    pushStatus: "SENT",
    pushError: truncatePushError(partialFailure),
  };
}

/**
 * Send notifications to multiple users at once (for example conversion events
 * that fan out to the affiliate plus their teachers).
 */
export async function createNotifications(
  notifications: CreateNotificationParams[]
) {
  return Promise.allSettled(notifications.map((n) => createNotification(n)));
}
