import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { affiliateGroupIdSchema, affiliateGroupInputSchema } from "@/lib/affiliate-group-validation";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = affiliateGroupInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid group" }, { status: 400 });
  }
  const { id } = await params;
  if (id.trim() !== id || !affiliateGroupIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid group ID" }, { status: 400 });
  }

  try {
    const { _count, ...group } = await prisma.affiliateGroup.update({
      where: { id },
      data: parsed.data,
      select: { id: true, name: true, color: true, _count: { select: { memberships: true } } },
    });
    return NextResponse.json({ data: { ...group, memberCount: _count.memberships } });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "P2025") return NextResponse.json({ error: "Group not found" }, { status: 404 });
    if (code === "P2002") {
      return NextResponse.json({ error: "A group with this name already exists" }, { status: 409 });
    }
    console.error("[admin/affiliate-groups] Update failed", error);
    return NextResponse.json({ error: "Unable to update group" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (id.trim() !== id || !affiliateGroupIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid group ID" }, { status: 400 });
  }
  try {
    // Cascades only to private memberships. No affiliate records are deleted.
    await prisma.affiliateGroup.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    console.error("[admin/affiliate-groups] Delete failed", error);
    return NextResponse.json({ error: "Unable to delete group" }, { status: 500 });
  }
}
