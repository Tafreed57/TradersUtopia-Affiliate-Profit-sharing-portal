import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import {
  matchesRewardfulAffiliateQuery,
  mergeAdminStudentSearchResults,
  type PortalStudentSearchUser,
} from "@/lib/admin-student-search";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

/**
 * GET /api/admin/student-search?q=&teacherId=
 *
 * Admin-only search for adding a student under a managed teacher. Includes
 * portal users plus commission-system affiliate accounts that have not signed
 * into the portal yet.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const teacherId = req.nextUrl.searchParams.get("teacherId")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json({ data: [], upstreamSearchFailed: false });
  }
  if (!teacherId) {
    return NextResponse.json({ error: "Teacher is required" }, { status: 400 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { id: true },
  });
  if (!teacher) {
    return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  }

  const existing = await prisma.teacherStudent.findMany({
    where: {
      teacherId,
      status: { in: ["ACTIVE", "PENDING"] },
    },
    select: { studentId: true },
  });
  const excludedUserIds = new Set([
    teacherId,
    ...existing.map((relationship) => relationship.studentId),
  ]);

  const localMatches = await prisma.user.findMany({
    where: {
      id: { notIn: Array.from(excludedUserIds) },
      status: "ACTIVE",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      rewardfulAffiliateId: true,
    },
    take: 10,
  });

  let upstreamSearchFailed = false;
  let upstreamMatches: Array<
    Pick<rewardful.RewardfulAffiliate, "id" | "email" | "first_name" | "last_name">
  > = [];

  try {
    upstreamMatches = await searchUpstreamAffiliates(q, 20);
  } catch (error) {
    upstreamSearchFailed = true;
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[admin-student-search] affiliate search failed:", msg);
  }

  let linkedLocalMatches: PortalStudentSearchUser[] = [];
  if (upstreamMatches.length > 0) {
    const upstreamIds = upstreamMatches.map((affiliate) => affiliate.id);
    const upstreamEmails = upstreamMatches.map((affiliate) =>
      affiliate.email.toLowerCase()
    );

    linkedLocalMatches = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludedUserIds) },
        status: "ACTIVE",
        OR: [
          { rewardfulAffiliateId: { in: upstreamIds } },
          { email: { in: upstreamEmails } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        rewardfulAffiliateId: true,
      },
      take: 20,
    });
  }

  const portalById = new Map<string, PortalStudentSearchUser>();
  for (const user of [...localMatches, ...linkedLocalMatches]) {
    portalById.set(user.id, user);
  }

  return NextResponse.json({
    data: mergeAdminStudentSearchResults({
      query: q,
      portalUsers: Array.from(portalById.values()),
      upstreamAffiliates: upstreamMatches,
      excludedUserIds,
      limit: 10,
    }),
    upstreamSearchFailed,
  });
}

async function searchUpstreamAffiliates(query: string, limit: number) {
  const matches: Array<
    Pick<rewardful.RewardfulAffiliate, "id" | "email" | "first_name" | "last_name">
  > = [];
  let page = 1;
  const pageLimit = 100;
  const maxPages = 10;

  for (let i = 0; i < maxPages; i++) {
    const result = await rewardful.listAffiliates({
      page,
      limit: pageLimit,
    });

    for (const affiliate of result.data) {
      if (!matchesRewardfulAffiliateQuery(affiliate, query)) continue;
      matches.push({
        id: affiliate.id,
        email: affiliate.email,
        first_name: affiliate.first_name,
        last_name: affiliate.last_name,
      });
      if (matches.length >= limit) return matches;
    }

    const nextPage = result.pagination.next_page;
    if (typeof nextPage !== "number" || nextPage <= page) return matches;
    page = nextPage;
  }

  return matches;
}
