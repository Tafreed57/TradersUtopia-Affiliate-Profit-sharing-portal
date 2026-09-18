import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { affiliateGroupInputSchema } from "@/lib/affiliate-group-validation";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [groups, ungroupedCount] = await Promise.all([
    prisma.affiliateGroup.findMany({
      select: { id: true, name: true, color: true, _count: { select: { memberships: true } } },
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
    }),
    prisma.user.count({ where: { affiliateGroupMembership: { is: null } } }),
  ]);
  return NextResponse.json({
    data: groups.map(({ _count, ...group }) => ({ ...group, memberCount: _count.memberships })),
    ungroupedCount,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = affiliateGroupInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid group" }, { status: 400 });
  }

  try {
    const group = await prisma.affiliateGroup.create({
      data: parsed.data,
      select: { id: true, name: true, color: true },
    });
    return NextResponse.json({ data: { ...group, memberCount: 0 } }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "A group with this name already exists" }, { status: 409 });
    }
    console.error("[admin/affiliate-groups] Create failed", error);
    return NextResponse.json({ error: "Unable to create group" }, { status: 500 });
  }
}
