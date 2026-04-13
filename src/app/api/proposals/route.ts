import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

const proposalSchema = z.object({
  studentId: z.string().min(1),
  proposedPercent: z.number().min(0).max(100),
});

/**
 * POST /api/proposals
 *
 * Teacher submits a rate proposal for a student.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { studentId, proposedPercent } = proposalSchema.parse(body);

    // Verify the teacher-student relationship exists
    const relationship = await prisma.teacherStudent.findUnique({
      where: {
        teacherId_studentId: {
          teacherId: session.user.id,
          studentId,
        },
      },
    });

    if (!relationship || !relationship.isActive) {
      return NextResponse.json(
        { error: "No active teacher-student relationship found" },
        { status: 404 }
      );
    }

    // Check if teacher can propose rates
    const teacher = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { canProposeRates: true },
    });

    if (!teacher?.canProposeRates) {
      return NextResponse.json(
        { error: "Rate proposal access has been revoked" },
        { status: 403 }
      );
    }

    // Check for existing pending proposal for same student
    const existingPending = await prisma.rateProposal.findFirst({
      where: {
        proposerId: session.user.id,
        studentId,
        status: "PENDING",
      },
    });

    if (existingPending) {
      return NextResponse.json(
        { error: "A pending proposal already exists for this student" },
        { status: 409 }
      );
    }

    const proposal = await prisma.rateProposal.create({
      data: {
        proposerId: session.user.id,
        studentId,
        proposedPercent,
        currentPercent: relationship.teacherCut,
        status: "PENDING",
      },
    });

    return NextResponse.json(proposal, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Proposal submission error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/proposals
 *
 * Returns proposals relevant to the current user (proposals they made).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const proposals = await prisma.rateProposal.findMany({
    where: { proposerId: session.user.id },
    include: {
      student: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ data: proposals });
}
