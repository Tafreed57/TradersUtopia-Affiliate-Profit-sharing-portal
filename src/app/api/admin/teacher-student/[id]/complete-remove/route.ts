import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { completeRemoveTeacherStudentRelationship } from "@/lib/teacher-student-relationships";

const completeRemoveSchema = z.object({
  archiveReason: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin || !session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const rawBody = await req.text();
    const body = rawBody
      ? completeRemoveSchema.parse(JSON.parse(rawBody))
      : {};

    const result = await completeRemoveTeacherStudentRelationship({
      relationshipId: id,
      removedById: session.user.id,
      archiveReason: body.archiveReason ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message === "Relationship not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (message === "Relationship is not active") {
      return NextResponse.json(
        { error: "Relationship is not active" },
        { status: 409 }
      );
    }
    if (message.includes("Only direct student relationships")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error(`[admin-complete-remove] failed for ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to completely remove relationship" },
      { status: 500 }
    );
  }
}

