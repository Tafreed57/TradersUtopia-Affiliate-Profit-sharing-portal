import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";

import { affiliateGroupIdSchema, parseAffiliatePagination } from "@/lib/affiliate-group-validation";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/affiliates
 *
 * Returns all affiliates with summary data. Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const search = req.nextUrl.searchParams.get("search") ?? "";
  const status = req.nextUrl.searchParams.get("status");
  const accountType = req.nextUrl.searchParams.get("accountType");
  const pagination = parseAffiliatePagination(req.nextUrl.searchParams);
  if (!pagination) return NextResponse.json({ error: "Page and limit must be positive integers" }, { status: 400 });
  const { page, limit, skip } = pagination;
  const groupId = req.nextUrl.searchParams.get("groupId");
  const grouped = req.nextUrl.searchParams.get("grouped") === "true";
  if (groupId !== null && (groupId.trim() !== groupId || !affiliateGroupIdSchema.safeParse(groupId).success)) {
    return NextResponse.json({ error: "Invalid group filter" }, { status: 400 });
  }

  const where: Prisma.UserWhereInput = {};
  if (accountType === "COMMISSION" || accountType === "WORK") where.accountType = accountType;
  if (groupId !== null) where.affiliateGroupMembership = groupId === "ungrouped" ? { is: null } : { is: { groupId } };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  if (status && (status === "ACTIVE" || status === "DEACTIVATED")) {
    where.status = status;
  }

  const [affiliates, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        status: true,
        accountType: true,
        affiliateGroupMembership: { select: { group: { select: { id: true, name: true, color: true } } } },
        commissionPercent: true,
        initialCommissionPercent: true,
        recurringCommissionPercent: true,
        canProposeRates: true,
        rewardfulAffiliateId: true,
        linkError: true,
        backfillError: true,
        createdAt: true,
        _count: {
          select: {
            recipientSplits: { where: { role: "AFFILIATE" } },
            studentRelations: { where: { status: "ACTIVE" } },
            teacherRelations: { where: { status: "ACTIVE" } },
          },
        },
      },
      // PostgreSQL's ascending order puts missing (NULL) relation names last.
      // Sort the complete result set before skip/take so pages preserve groups.
      orderBy: grouped
        ? [{ affiliateGroupMembership: { group: { nameKey: "asc" } } }, { createdAt: "desc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "asc" }],
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  const data = affiliates.map(({ affiliateGroupMembership, ...a }) => ({
    ...a,
    affiliateGroup: affiliateGroupMembership?.group ?? null,
    commissionPercent: a.commissionPercent.toNumber(),
    initialCommissionPercent: a.initialCommissionPercent.toNumber(),
    recurringCommissionPercent: a.recurringCommissionPercent.toNumber(),
    commissionsCount: a._count.recipientSplits,
    studentsCount: a._count.studentRelations,
    teachersCount: a._count.teacherRelations,
    _count: undefined,
  }));

  return NextResponse.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
