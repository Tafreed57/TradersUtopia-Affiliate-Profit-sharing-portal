/**
 * Seed script — populates the database with test data for development.
 *
 * Run with: npx tsx prisma/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Clean existing data (order matters for FK constraints)
  await prisma.commission.deleteMany();
  await prisma.commissionRateAudit.deleteMany();
  await prisma.rateProposal.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.promoCodeRequest.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.deviceToken.deleteMany();
  await prisma.teacherStudent.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.exchangeRateCache.deleteMany();
  await prisma.user.deleteMany();

  const password = await bcrypt.hash("password123", 12);

  // -----------------------------------------------------------------------
  // Users
  // -----------------------------------------------------------------------

  const admin = await prisma.user.create({
    data: {
      email: "admin@tradersutopia.com",
      name: "Admin User",
      passwordHash: password,
      commissionPercent: 0,
      rewardfulAffiliateId: null,
    },
  });

  const alice = await prisma.user.create({
    data: {
      email: "alice@example.com",
      name: "Alice Johnson",
      passwordHash: password,
      commissionPercent: 40,
      rewardfulAffiliateId: "aff_alice_test",
    },
  });

  const bob = await prisma.user.create({
    data: {
      email: "bob@example.com",
      name: "Bob Smith",
      passwordHash: password,
      commissionPercent: 35,
      rewardfulAffiliateId: "aff_bob_test",
    },
  });

  const charlie = await prisma.user.create({
    data: {
      email: "charlie@example.com",
      name: "Charlie Davis",
      passwordHash: password,
      commissionPercent: 30,
      rewardfulAffiliateId: "aff_charlie_test",
    },
  });

  const diana = await prisma.user.create({
    data: {
      email: "diana@example.com",
      name: "Diana Lee",
      passwordHash: password,
      commissionPercent: 25,
      rewardfulAffiliateId: "aff_diana_test",
    },
  });

  console.log("  Created 5 users");

  // -----------------------------------------------------------------------
  // Teacher-Student Relationships
  // -----------------------------------------------------------------------
  // Alice teaches Bob (10% cut) and Charlie (12% cut)
  // Bob teaches Diana (8% cut)
  // Alice also gets from Diana at depth 2 (5% cut)

  await prisma.teacherStudent.createMany({
    data: [
      { teacherId: alice.id, studentId: bob.id, depth: 1, teacherCut: 10 },
      {
        teacherId: alice.id,
        studentId: charlie.id,
        depth: 1,
        teacherCut: 12,
      },
      { teacherId: bob.id, studentId: diana.id, depth: 1, teacherCut: 8 },
      { teacherId: alice.id, studentId: diana.id, depth: 2, teacherCut: 5 },
    ],
  });

  console.log("  Created 4 teacher-student relationships");

  // -----------------------------------------------------------------------
  // Attendance (last 7 days for active affiliates)
  // -----------------------------------------------------------------------
  const today = new Date();
  const attendanceRecords = [];

  for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = date.toISOString().slice(0, 10);

    // Alice submits every day
    attendanceRecords.push({
      userId: alice.id,
      date: dateStr,
      timezone: "America/Toronto",
      note: daysAgo === 0 ? "Social media campaigns" : null,
    });

    // Bob misses day 3
    if (daysAgo !== 3) {
      attendanceRecords.push({
        userId: bob.id,
        date: dateStr,
        timezone: "America/Vancouver",
      });
    }

    // Charlie submits every other day
    if (daysAgo % 2 === 0) {
      attendanceRecords.push({
        userId: charlie.id,
        date: dateStr,
        timezone: "America/Chicago",
        note: "Blog posts and email campaigns",
      });
    }

    // Diana submits most days
    if (daysAgo !== 5) {
      attendanceRecords.push({
        userId: diana.id,
        date: dateStr,
        timezone: "America/New_York",
      });
    }
  }

  await prisma.attendance.createMany({ data: attendanceRecords });
  console.log(`  Created ${attendanceRecords.length} attendance records`);

  // -----------------------------------------------------------------------
  // Commissions (sample data)
  // -----------------------------------------------------------------------

  const commissions = [];
  const baseDate = new Date(today);
  baseDate.setDate(baseDate.getDate() - 10);

  // Alice's commissions (all earned — she has perfect attendance)
  for (let i = 0; i < 5; i++) {
    const convDate = new Date(baseDate);
    convDate.setDate(convDate.getDate() + i * 2);
    const fullAmount = 100 + i * 25;
    const aliceCut = fullAmount * 0.4;
    const ceoCut = fullAmount - aliceCut;

    commissions.push({
      affiliateId: alice.id,
      teacherId: null,
      rewardfulCommissionId: `comm_alice_${i}`,
      fullAmountCad: fullAmount,
      affiliateCutPercent: 40,
      affiliateCutCad: aliceCut,
      ceoCutCad: ceoCut,
      status: "EARNED" as const,
      conversionDate: convDate,
    });
  }

  // Bob's commissions (one forfeited on day 3 due to missing attendance)
  for (let i = 0; i < 4; i++) {
    const convDate = new Date(baseDate);
    convDate.setDate(convDate.getDate() + i * 2 + 1);
    const fullAmount = 80 + i * 30;
    const bobPercent = 35;
    const bobCut = fullAmount * (bobPercent / 100);
    const aliceTeacherCut = fullAmount * 0.1;
    const ceoCutBase = fullAmount - bobCut - aliceTeacherCut;

    const isForfeited = i === 1; // Simulate forfeiture

    // Bob's own record
    commissions.push({
      affiliateId: bob.id,
      teacherId: null,
      rewardfulCommissionId: `comm_bob_${i}`,
      fullAmountCad: fullAmount,
      affiliateCutPercent: bobPercent,
      affiliateCutCad: isForfeited ? 0 : bobCut,
      ceoCutCad: isForfeited ? ceoCutBase + bobCut : ceoCutBase,
      status: isForfeited ? ("FORFEITED" as const) : ("EARNED" as const),
      forfeitedToCeo: isForfeited,
      forfeitureReason: isForfeited
        ? "No attendance submitted for conversion date"
        : null,
      conversionDate: convDate,
    });

    // Alice's teacher commission from Bob
    commissions.push({
      affiliateId: bob.id,
      teacherId: alice.id,
      rewardfulCommissionId: `comm_bob_${i}`,
      fullAmountCad: fullAmount,
      affiliateCutPercent: bobPercent,
      affiliateCutCad: isForfeited ? 0 : bobCut,
      teacherCutPercent: 10,
      teacherCutCad: aliceTeacherCut,
      ceoCutCad: isForfeited ? ceoCutBase + bobCut : ceoCutBase,
      status: isForfeited ? ("FORFEITED" as const) : ("EARNED" as const),
      forfeitedToCeo: isForfeited,
      forfeitureReason: isForfeited
        ? "No attendance submitted for conversion date"
        : null,
      conversionDate: convDate,
    });
  }

  await prisma.commission.createMany({ data: commissions });
  console.log(`  Created ${commissions.length} commission records`);

  // -----------------------------------------------------------------------
  // Rate Proposals
  // -----------------------------------------------------------------------

  await prisma.rateProposal.create({
    data: {
      proposerId: alice.id,
      studentId: bob.id,
      proposedPercent: 12,
      currentPercent: 10,
      status: "PENDING",
    },
  });

  console.log("  Created 1 pending rate proposal");

  // -----------------------------------------------------------------------
  // Exchange Rate Cache
  // -----------------------------------------------------------------------

  await prisma.exchangeRateCache.create({
    data: {
      fromCurrency: "CAD",
      toCurrency: "USD",
      rate: 0.735,
      fetchedAt: new Date(),
    },
  });

  console.log("  Seeded exchange rate cache (CAD/USD = 0.735)");

  console.log("\nSeed complete!");
  console.log("\nTest accounts (all passwords: 'password123'):");
  console.log(`  Admin:   admin@tradersutopia.com`);
  console.log(`  Alice:   alice@example.com (teacher)`);
  console.log(`  Bob:     bob@example.com (student of Alice, teacher of Diana)`);
  console.log(`  Charlie: charlie@example.com (student of Alice)`);
  console.log(`  Diana:   diana@example.com (student of Bob, depth-2 of Alice)`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
