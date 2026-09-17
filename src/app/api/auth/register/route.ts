import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { canClaimUpstreamPlaceholder } from "@/lib/upstream-placeholder-account";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  accountType: z.enum(["COMMISSION", "WORK"]).default("COMMISSION"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password, accountType } = registerSchema.parse(body);

    const normalizedEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        rewardfulAffiliateId: true,
        accounts: { select: { id: true }, take: 1 },
      },
    });

    const passwordHash = await bcrypt.hash(password, 12);

    if (existing) {
      if (canClaimUpstreamPlaceholder(existing)) {
        const claim = await prisma.user.updateMany({
          where: {
            id: existing.id,
            status: "ACTIVE",
            passwordHash: null,
            accounts: { none: {} },
          },
          data: {
            name,
            passwordHash,
            linkError: null,
          },
        });
        if (claim.count !== 1) {
          return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
        }
        return NextResponse.json({ id: existing.id, email: existing.email, name }, { status: 201 });
      }

      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        accountType,
        ...(accountType === "WORK" ? { canBeTeacher: false, canProposeRates: false } : {}),
      },
    });

    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name },
      { status: 201 }
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
