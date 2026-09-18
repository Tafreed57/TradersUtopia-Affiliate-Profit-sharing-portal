import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";

import { affiliateGroupAssignmentSchema } from "@/lib/affiliate-group-validation";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

class AssignmentTargetNotFound extends Error {}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = affiliateGroupAssignmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose 1–100 unique affiliates and a valid group" }, { status: 400 });
  }
  const { groupId } = parsed.data;
  const affiliateIds = [...parsed.data.affiliateIds].sort();

  try {
    const updatedCount = await prisma.$transaction(async (tx) => {
      if (groupId !== null && !await tx.affiliateGroup.findUnique({ where: { id: groupId }, select: { id: true } })) {
        throw new AssignmentTargetNotFound("Group not found");
      }
      // Retain every target until commit without writing to User. Sorted locks
      // also keep simultaneous bulk assignments from locking users out of order.
      const users = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "User"
        WHERE "id" IN (${Prisma.join(affiliateIds)})
        ORDER BY "id" FOR KEY SHARE
      `);
      if (users.length !== affiliateIds.length) {
        throw new AssignmentTargetNotFound("One or more affiliates were not found");
      }
      if (groupId === null) {
        await tx.affiliateGroupMembership.deleteMany({ where: { userId: { in: affiliateIds } } });
      } else {
        // One bulk upsert avoids one network round trip per selected affiliate.
        // The primary key serializes concurrent assignments of the same user.
        const rows = affiliateIds.map((userId) => Prisma.sql`(${userId}, ${groupId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
        const updatedCount = await tx.$executeRaw(Prisma.sql`
          INSERT INTO "AffiliateGroupMembership" ("userId", "groupId", "createdAt", "updatedAt")
          VALUES ${Prisma.join(rows)}
          ON CONFLICT ("userId") DO UPDATE
          SET "groupId" = EXCLUDED."groupId", "updatedAt" = CURRENT_TIMESTAMP
        `);
        if (updatedCount !== affiliateIds.length) {
          throw new AssignmentTargetNotFound("One or more affiliates were not found");
        }
      }
      return affiliateIds.length;
    });
    return NextResponse.json({ success: true, updatedCount });
  } catch (error) {
    if (error instanceof AssignmentTargetNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    // The group may have been removed after lookup but before the FK check.
    const databaseError = error as { code?: string; meta?: { code?: string } } | null;
    if (databaseError?.code === "P2003" || (databaseError?.code === "P2010" && databaseError.meta?.code === "23503")) {
      return NextResponse.json({ error: "One or more affiliates or the group were not found" }, { status: 404 });
    }
    if (databaseError?.code === "P2034" || (databaseError?.code === "P2010" && ["40P01", "40001"].includes(databaseError.meta?.code ?? ""))) {
      return NextResponse.json({ error: "Assignments changed concurrently. Please try again." }, { status: 409 });
    }
    console.error("[admin/affiliate-groups] Assignment failed", error);
    return NextResponse.json({ error: "Unable to assign affiliates" }, { status: 500 });
  }
}
