import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { archiveTeacherStudentRelationship } from "@/lib/teacher-student-relationships";

const deleteSchema = z.object({
  showInPreviousStudents: z.boolean().optional(),
  archiveReason: z.string().max(500).optional(),
});

/**
 * DELETE /api/admin/teacher-student/:id
 *
 * Safely archives an active teacher-student relationship. Existing commission
 * rows stay intact and continue progressing to paid later; the archive snapshot
 * powers the "previous students" history.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const rawBody = await req.text();
    const body = rawBody ? deleteSchema.parse(JSON.parse(rawBody)) : {};

    const result = await archiveTeacherStudentRelationship({
      relationshipId: id,
      archivedById: session.user.id,
      archivedByRole: "ADMIN",
      showInPreviousStudents: body.showInPreviousStudents ?? true,
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

    console.error(`[admin-teacher-student-delete] failed for ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to archive relationship" },
      { status: 500 }
    );
  }
}
