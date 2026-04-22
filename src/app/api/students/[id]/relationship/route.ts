import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { archiveTeacherStudentRelationship } from "@/lib/teacher-student-relationships";
import { prisma } from "@/lib/prisma";

const deleteSchema = z.object({
  archiveReason: z.string().max(500).optional(),
});

/**
 * DELETE /api/students/:id/relationship
 *
 * Teacher safely removes one direct student while preserving the historical
 * money trail in the archived episode.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: studentId } = await params;

  try {
    const rawBody = await req.text();
    const body = rawBody ? deleteSchema.parse(JSON.parse(rawBody)) : {};

    const relationship = await prisma.teacherStudent.findFirst({
      where: {
        teacherId: session.user.id,
        studentId,
        depth: 1,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    if (!relationship) {
      return NextResponse.json(
        { error: "No active direct student relationship found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      await archiveTeacherStudentRelationship({
        relationshipId: relationship.id,
        archivedById: session.user.id,
        archivedByRole: "TEACHER",
        showInPreviousStudents: true,
        archiveReason:
          body.archiveReason ?? "Teacher removed this student from their roster.",
      })
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[student-relationship-delete] failed for teacher=${session.user.id} student=${studentId}: ${message}`
    );
    return NextResponse.json(
      { error: "Failed to remove student" },
      { status: 500 }
    );
  }
}
