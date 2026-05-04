import { Prisma, PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";
import process from "node:process";

for (const envFile of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Optional in CI and deployment shells.
  }
}

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REASON = "No attendance submitted for conversion date";
const STALE_NOTIFICATION_WHERE = {
  type: "ATTENDANCE_FORFEITURE_ALERT",
  OR: [
    { title: "Commission Forfeited" },
    { body: { contains: "missed attendance", mode: "insensitive" } },
    { body: { contains: "forfeited", mode: "insensitive" } },
  ],
};

function toDecimal(value) {
  return new Decimal(value.toString());
}

function money(value) {
  return value.toDecimalPlaces(2).toNumber();
}

function splitMatchesAttendanceForfeit(split) {
  return split.status === "FORFEITED" && split.forfeitureReason === REASON;
}

async function legacyCommissionTableExists() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."Commission"')::text AS table_name`
  );
  return Boolean(rows[0]?.table_name);
}

async function countLegacyCandidates() {
  if (!(await legacyCommissionTableExists())) return 0;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count
     FROM "Commission"
     WHERE status = 'FORFEITED'
       AND "forfeitureReason" = $1`,
    REASON
  );
  return Number(rows[0]?.count ?? 0);
}

async function restoreLegacyCandidates() {
  if (!(await legacyCommissionTableExists())) return 0;
  return prisma.$executeRawUnsafe(
    `UPDATE "Commission"
     SET status = 'EARNED',
         "forfeitedToCeo" = false,
         "forfeitureReason" = NULL,
         "affiliateCutCad" = CASE
           WHEN "teacherId" IS NULL
             THEN ROUND(("fullAmountCad" * "affiliateCutPercent" / 100)::numeric, 2)
           ELSE "affiliateCutCad"
         END,
         "ceoCutCad" = CASE
           WHEN "teacherId" IS NULL
             THEN ROUND(("ceoCutCad" - ("fullAmountCad" * "affiliateCutPercent" / 100))::numeric, 2)
           ELSE "ceoCutCad"
         END
     WHERE status = 'FORFEITED'
       AND "forfeitureReason" = $1`,
    REASON
  );
}

async function main() {
  const events = await prisma.commissionEvent.findMany({
    where: {
      splits: {
        some: {
          status: "FORFEITED",
          forfeitureReason: REASON,
        },
      },
    },
    select: {
      id: true,
      rewardfulCommissionId: true,
      affiliateId: true,
      fullAmount: true,
      ceoCut: true,
      splits: {
        select: {
          id: true,
          recipientId: true,
          role: true,
          status: true,
          cutPercent: true,
          cutAmount: true,
          forfeitureReason: true,
        },
      },
    },
  });

  let affiliateSplits = 0;
  let teacherSplits = 0;
  let eventsChanged = 0;
  const usersAffected = new Set();

  for (const event of events) {
    const affiliateSplit = event.splits.find(
      (split) => split.role === "AFFILIATE" && splitMatchesAttendanceForfeit(split)
    );
    const teacherMatches = event.splits.filter(
      (split) => split.role === "TEACHER" && splitMatchesAttendanceForfeit(split)
    );

    if (!affiliateSplit && teacherMatches.length === 0) continue;

    const ops = [];
    let eventWillChange = false;

    if (affiliateSplit) {
      const fullAmount = toDecimal(event.fullAmount);
      const affiliatePercent = toDecimal(affiliateSplit.cutPercent);
      const restoredAffiliateCut = fullAmount.mul(affiliatePercent).div(100);
      const teacherCutTotal = event.splits
        .filter((split) => split.role === "TEACHER")
        .reduce(
          (sum, split) => sum.add(toDecimal(split.cutAmount)),
          new Decimal(0)
        );
      const restoredCeoCut = fullAmount
        .sub(restoredAffiliateCut)
        .sub(teacherCutTotal);

      if (restoredCeoCut.lt(0)) {
        throw new Error(
          `Refusing to restore event ${event.rewardfulCommissionId ?? event.id}: ` +
            `recomputed CEO cut would be ${restoredCeoCut.toString()}`
        );
      }

      affiliateSplits += 1;
      usersAffected.add(affiliateSplit.recipientId);
      usersAffected.add(event.affiliateId);
      eventWillChange = true;

      if (APPLY) {
        ops.push(
          prisma.commissionSplit.updateMany({
            where: {
              id: affiliateSplit.id,
              status: "FORFEITED",
              forfeitureReason: REASON,
            },
            data: {
              status: "EARNED",
              cutAmount: money(restoredAffiliateCut),
              forfeitedToCeo: false,
              forfeitureReason: null,
            },
          }),
          prisma.commissionEvent.update({
            where: { id: event.id },
            data: { ceoCut: money(restoredCeoCut) },
          })
        );
      }
    }

    if (teacherMatches.length > 0) {
      teacherSplits += teacherMatches.length;
      eventWillChange = true;
      for (const split of teacherMatches) usersAffected.add(split.recipientId);

      if (APPLY) {
        ops.push(
          prisma.commissionSplit.updateMany({
            where: {
              id: { in: teacherMatches.map((split) => split.id) },
              status: "FORFEITED",
              forfeitureReason: REASON,
            },
            data: {
              status: "EARNED",
              forfeitedToCeo: false,
              forfeitureReason: null,
            },
          })
        );
      }
    }

    if (eventWillChange) eventsChanged += 1;
    if (APPLY && ops.length > 0) await prisma.$transaction(ops);
  }

  const legacyCandidates = await countLegacyCandidates();
  const legacyRestored = APPLY ? await restoreLegacyCandidates() : 0;
  const notificationCandidates = await prisma.notification.count({
    where: STALE_NOTIFICATION_WHERE,
  });
  const notificationUpdates = APPLY
    ? await prisma.notification.updateMany({
        where: STALE_NOTIFICATION_WHERE,
        data: {
          title: "Commission Restored",
          body: "A previous commission has been restored. Attendance is now tracked as activity only.",
        },
      })
    : { count: 0 };

  if (APPLY && usersAffected.size > 0) {
    await prisma.user.updateMany({
      where: { id: { in: [...usersAffected] } },
      data: {
        lifetimeStatsCachedAt: null,
        lifetimeStatsJson: Prisma.JsonNull,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        active: {
          eventsChanged,
          affiliateSplits,
          teacherSplits,
          usersAffected: usersAffected.size,
        },
        legacy: {
          candidates: legacyCandidates,
          restored: legacyRestored,
        },
        notifications: {
          candidates: notificationCandidates,
          updated: notificationUpdates.count,
        },
        applied: APPLY,
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write these repairs.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
