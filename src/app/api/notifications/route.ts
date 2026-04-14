import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

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

  const where: Record<string, unknown> = { userId: session.user.id };
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
      where: { userId: session.user.id, read: false },
    }),
  ]);

  return NextResponse.json({
    data: notifications,
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
