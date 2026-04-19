import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/admin/affiliates/:id/lock
 *
 * Toggles the affiliate's `ratesLocked` flag (onboarding lock).
 *   false (default, unlocked): rate changes re-price all EARNED+PENDING
 *     splits retroactively. Use during onboarding while admin iterates
 *     on the rate.
 *   true (locked): rate changes apply only to future webhook-delivered
 *     commissions. Existing splits stay frozen.
 *
 * Writes a CommissionRateAudit row with field=LOCK and
 * appliedMode=LOCK/UNLOCK so the change is visible in the rate history
 * alongside the actual rate edits.
 */
const bodySchema = z.object({
  locked: z.boolean(),
  reason: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, ratesLocked: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (user.ratesLocked === body.locked) {
    return NextResponse.json(
      { ok: true, ratesLocked: user.ratesLocked, note: "Already in requested state" },
      { status: 200 }
    );
  }

  // Atomic: flip the flag + write the audit row together. previousPercent
  // and newPercent carry 0/1 so the row slots into the existing audit
  // table without needing a nullable schema.
  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { ratesLocked: body.locked },
    }),
    prisma.commissionRateAudit.create({
      data: {
        affiliateId: id,
        changedById: session.user.id,
        previousPercent: user.ratesLocked ? 1 : 0,
        newPercent: body.locked ? 1 : 0,
        field: "LOCK",
        appliedMode: body.locked ? "LOCK" : "UNLOCK",
        reason: body.reason ?? null,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    ratesLocked: body.locked,
    mode: body.locked ? "LOCKED" : "UNLOCKED",
  });
}
