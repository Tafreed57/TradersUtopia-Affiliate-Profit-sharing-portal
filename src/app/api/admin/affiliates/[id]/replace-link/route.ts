import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { replaceAffiliateLink } from "@/lib/affiliate-link-replacement";
import { authOptions } from "@/lib/auth-options";

const bodySchema = z.object({
  identifier: z.string().trim().min(1).max(200),
});

export const maxDuration = 300;

/**
 * POST /api/admin/affiliates/:id/replace-link
 *
 * Replaces the upstream affiliate account linked to a portal user.
 * The portal user stays the same, but imported commission history is
 * cleared first so histories from two different upstream affiliates
 * are never merged onto one local user.
 */
export async function POST(
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

  try {
    const result = await replaceAffiliateLink({
      userId: id,
      identifier: body.identifier,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message === "User not found."
        ? 404
        : /could not find/i.test(message)
          ? 404
          : /already linked|currently running/i.test(message)
          ? 409
          : 500;

    if (status === 500) {
      console.error("[replace-link] failed:", err);
    }

    return NextResponse.json({ error: message }, { status });
  }
}
