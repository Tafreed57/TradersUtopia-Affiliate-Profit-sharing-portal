import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/proposals
 *
 * Returns all rate proposals (pending first). Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const proposals = await prisma.rateProposal.findMany({
    include: {
      proposer: { select: { id: true, name: true, email: true } },
      student: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return NextResponse.json({
    data: proposals.map((p) => ({
      ...p,
      proposedPercent: p.proposedPercent.toNumber(),
      currentPercent: p.currentPercent.toNumber(),
    })),
  });
}

const reviewSchema = z.object({
  proposalId: z.string(),
  action: z.enum(["approve", "reject"]),
  reviewNote: z.string().optional(),
});

/**
 * POST /api/admin/proposals
 *
 * Admin reviews (approves/rejects) a rate proposal.
 * On approval, updates the TeacherStudent.teacherCut and creates audit log.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { proposalId, action, reviewNote } = reviewSchema.parse(body);

    const proposal = await prisma.rateProposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      );
    }

    if (proposal.status !== "PENDING") {
      return NextResponse.json(
        { error: "Proposal already reviewed" },
        { status: 409 }
      );
    }

    if (action === "reject") {
      const updated = await prisma.rateProposal.update({
        where: { id: proposalId },
        data: {
          status: "REJECTED",
          reviewedById: session.user.id,
          reviewNote: reviewNote ?? null,
          reviewedAt: new Date(),
        },
      });
      return NextResponse.json(updated);
    }

    // Approve — update TeacherStudent cut and create audit log
    await prisma.$transaction(async (tx) => {
      // Update proposal status
      await tx.rateProposal.update({
        where: { id: proposalId },
        data: {
          status: "APPROVED",
          reviewedById: session.user.id,
          reviewNote: reviewNote ?? null,
          reviewedAt: new Date(),
        },
      });

      // Update teacher-student cut
      await tx.teacherStudent.update({
        where: {
          teacherId_studentId: {
            teacherId: proposal.proposerId,
            studentId: proposal.studentId,
          },
        },
        data: { teacherCut: proposal.proposedPercent },
      });

      // Create audit log
      await tx.commissionRateAudit.create({
        data: {
          affiliateId: proposal.studentId,
          changedById: session.user.id,
          previousPercent: proposal.currentPercent,
          newPercent: proposal.proposedPercent,
          reason: `Rate proposal approved (proposed by teacher)${reviewNote ? `: ${reviewNote}` : ""}`,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Admin proposal review error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
