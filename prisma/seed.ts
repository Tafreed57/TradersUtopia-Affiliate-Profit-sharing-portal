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

  // Clean existing data (order matters for FK constraints).
  // The legacy `Commission` table is @@ignore'd in the Prisma schema but
  // still physically present until its drop migration runs; clear it via
  // raw SQL so subsequent `user.deleteMany()` doesn't trip its FK.
  // Guarded with `to_regclass` so this no-ops after the drop migration.
  await prisma.$executeRawUnsafe(
    `DO $$ BEGIN IF to_regclass('public."Commission"') IS NOT NULL THEN DELETE FROM "Commission"; END IF; END $$;`
  );
  await prisma.commissionSplit.deleteMany();
  await prisma.commissionEvent.deleteMany();
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
      initialCommissionPercent: 0,
      recurringCommissionPercent: 0,
      rewardfulAffiliateId: null,
    },
  });

  const alice = await prisma.user.create({
    data: {
      email: "alice@example.com",
      name: "Alice Johnson",
      passwordHash: password,
      commissionPercent: 40,
      initialCommissionPercent: 40,
      recurringCommissionPercent: 40,
      rewardfulAffiliateId: "aff_alice_test",
    },
  });

  const bob = await prisma.user.create({
    data: {
      email: "bob@example.com",
      name: "Bob Smith",
      passwordHash: password,
      commissionPercent: 35,
      initialCommissionPercent: 35,
      recurringCommissionPercent: 35,
      rewardfulAffiliateId: "aff_bob_test",
    },
  });

  const charlie = await prisma.user.create({
    data: {
      email: "charlie@example.com",
      name: "Charlie Davis",
      passwordHash: password,
      commissionPercent: 30,
      initialCommissionPercent: 30,
      recurringCommissionPercent: 30,
      rewardfulAffiliateId: "aff_charlie_test",
    },
  });

  const diana = await prisma.user.create({
    data: {
      email: "diana@example.com",
      name: "Diana Lee",
      passwordHash: password,
      commissionPercent: 25,
      initialCommissionPercent: 25,
      recurringCommissionPercent: 25,
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

  // Commission seeding is intentionally omitted — sample commissions are
  // generated by webhook in prod-like test runs, and the legacy `Commission`
  // model is @@ignore'd in favor of CommissionEvent + CommissionSplit.

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
