import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { getCommissionCadAllocations } from "@/lib/commission-cad-service";
import { getCommissionValueNotificationCopy } from "@/lib/commission-value-notification-data";
import { sanitizeNotificationCopy } from "@/lib/notification-privacy";
import { prisma } from "@/lib/prisma";
import { isWorkPortalUser } from "@/lib/account-access";
import { isAdminEmail } from "@/lib/constants";
import { WORK_NOTIFICATION_TYPES, workNotificationPresentation } from "@/lib/work-notification-policy";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getCommissionSplitId(data: unknown): string | null {
  const record = asRecord(data);
  return typeof record?.commissionSplitId === "string"
    ? record.commissionSplitId
    : null;
}

/**
 * GET /api/notifications
 *
 * Returns notifications for the authenticated user.
 * Query params: unreadOnly (boolean), page, limit
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit") ?? "20"))
  );

  const recipient = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { accountType: true, email: true },
  });
  if (!recipient) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workUser = isWorkPortalUser({ ...recipient, isAdmin: isAdminEmail(recipient.email) });
  const typeFilter = workUser ? { type: { in: WORK_NOTIFICATION_TYPES } } : {};
  const where: Record<string, unknown> = { userId: session.user.id, ...typeFilter };
  if (unreadOnly) where.read = false;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: { userId: session.user.id, read: false, ...typeFilter },
    }),
  ]);

  const commissionSplitIds = [
    ...new Set(
      notifications
        .filter((notification) => notification.type === "CONVERSION_RECEIVED")
        .map((notification) => getCommissionSplitId(notification.data))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const commissionSplits =
    commissionSplitIds.length > 0
      ? await prisma.commissionSplit.findMany({
          where: {
            id: { in: commissionSplitIds },
            recipientId: session.user.id,
          },
          select: {
            id: true,
            recipientId: true,
            role: true,
            cutPercent: true,
            cutAmount: true,
            providerCutCad: true,
            status: true,
            recipient: {
              select: {
                id: true,
                status: true,
                canSeeRecurringCommissions: true,
                recurringCommissionsVisibleFrom: true,
              },
            },
            event: {
              select: {
                id: true,
                affiliateId: true,
                rewardfulCommissionId: true,
                isRecurring: true,
                conversionDate: true,
                currency: true,
              },
            },
          },
        })
      : [];
  const cadAllocations =
    commissionSplits.length > 0
      ? await getCommissionCadAllocations(
          commissionSplits.map((split) => split.event.affiliateId)
        )
      : new Map();
  const commissionSplitById = new Map(
    commissionSplits.map((split) => [split.id, split])
  );

  const safeNotifications = notifications.map((notification) => {
    if (workUser) {
      return {
        id: notification.id,
        type: notification.type,
        ...workNotificationPresentation(notification.type),
        read: notification.read,
        createdAt: notification.createdAt,
      };
    }
    const splitId = getCommissionSplitId(notification.data);
    const split = splitId ? commissionSplitById.get(splitId) : null;
    const valueCopy =
      split && notification.type === "CONVERSION_RECEIVED"
        ? getCommissionValueNotificationCopy(
            {
              id: split.event.id,
              rewardfulCommissionId: split.event.rewardfulCommissionId,
              isRecurring: split.event.isRecurring,
              conversionDate: split.event.conversionDate,
              currency: split.event.currency,
            },
            {
              id: split.id,
              recipientId: split.recipientId,
              role: split.role,
              cutPercent: split.cutPercent,
              cutAmount: split.cutAmount,
              providerCutCad:
                cadAllocations
                  .get(split.event.affiliateId)
                  ?.splitCadById.get(split.id)
                  ?.toDecimalPlaces(2)
                  .toString() ?? split.providerCutCad,
              status: split.status,
              recipient: split.recipient,
            }
          )
        : null;
    const copy = sanitizeNotificationCopy(
      notification.type,
      valueCopy?.title ?? notification.title,
      valueCopy?.body ?? notification.body
    );
    return {
      ...notification,
      title: copy.title,
      body: copy.body,
    };
  });

  return NextResponse.json({
    data: safeNotifications,
    unreadCount,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

/**
 * PATCH /api/notifications
 *
 * Mark notifications as read.
 * Body: { ids: string[] } or { all: true }
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (body.all === true) {
      await prisma.notification.updateMany({
        where: { userId: session.user.id, read: false },
        data: { read: true },
      });
      return NextResponse.json({ success: true });
    }

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      await prisma.notification.updateMany({
        where: {
          id: { in: body.ids },
          userId: session.user.id,
        },
        data: { read: true },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Provide { ids: [...] } or { all: true }" },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
