import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const env = fs.readFileSync(envPath, "utf8");
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadEnv();
const prisma = new PrismaClient();

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value.toString());
}

function money(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

async function getCandidates() {
  return prisma.$queryRaw`
    SELECT
      cs.id AS split_id,
      cs.status AS split_status,
      cs."cutCad"::text AS cut_native,
      cs."cutPercent"::text AS split_cut_percent,
      cs."createdAt" AS split_created_at,
      cs."recipientId" AS teacher_id,
      teacher.name AS teacher_name,
      teacher.email AS teacher_email,
      ce.id AS event_id,
      ce."affiliateId" AS student_id,
      student.name AS student_name,
      student.email AS student_email,
      ce.currency AS currency,
      ce."conversionDate" AS conversion_date,
      ts.id AS relationship_id,
      ts."activationSequence" AS relationship_sequence,
      ts."teacherCut"::text AS relationship_cut_percent,
      ts."activatedAt" AS relationship_activated_at
    FROM "CommissionSplit" cs
    JOIN "CommissionEvent" ce ON ce.id = cs."eventId"
    JOIN "User" teacher ON teacher.id = cs."recipientId"
    JOIN "User" student ON student.id = ce."affiliateId"
    JOIN "TeacherStudent" ts
      ON ts."teacherId" = cs."recipientId"
     AND ts."studentId" = ce."affiliateId"
     AND ts.status = 'ACTIVE'
    WHERE cs.role = 'TEACHER'
      AND cs."teacherStudentId" IS NULL
      AND cs."createdAt" >= ts."activatedAt"
      AND ABS(cs."cutPercent" - ts."teacherCut") <= 0.01
    ORDER BY teacher.email, student.email, ce."conversionDate", cs.id`;
}

async function getSkippedSummary() {
  return prisma.$queryRaw`
    SELECT
      reason,
      COUNT(*)::int AS count,
      COALESCE(SUM(cut_native), 0)::text AS sum_native
    FROM (
      SELECT
        cs."cutCad" AS cut_native,
        CASE
          WHEN ts.id IS NULL THEN 'no_active_relationship'
          WHEN cs."createdAt" < ts."activatedAt" THEN 'split_before_active_episode'
          WHEN ABS(cs."cutPercent" - ts."teacherCut") > 0.01 THEN 'cut_percent_mismatch'
          ELSE 'candidate'
        END AS reason
      FROM "CommissionSplit" cs
      JOIN "CommissionEvent" ce ON ce.id = cs."eventId"
      LEFT JOIN "TeacherStudent" ts
        ON ts."teacherId" = cs."recipientId"
       AND ts."studentId" = ce."affiliateId"
       AND ts.status = 'ACTIVE'
      WHERE cs.role = 'TEACHER'
        AND cs."teacherStudentId" IS NULL
    ) rows
    GROUP BY reason
    ORDER BY reason`;
}

function summarize(rows) {
  const byPair = new Map();
  const byStatus = new Map();
  let totalNative = 0;

  for (const row of rows) {
    totalNative += toNumber(row.cut_native);
    const pairKey = `${row.teacher_email} -> ${row.student_email}`;
    const pair = byPair.get(pairKey) ?? {
      teacher: row.teacher_name ?? row.teacher_email,
      teacherEmail: row.teacher_email,
      student: row.student_name ?? row.student_email,
      studentEmail: row.student_email,
      count: 0,
      sumNative: 0,
      relationshipId: row.relationship_id,
      relationshipSequence: row.relationship_sequence,
    };
    pair.count += 1;
    pair.sumNative += toNumber(row.cut_native);
    byPair.set(pairKey, pair);

    const status = row.split_status;
    const statusSummary = byStatus.get(status) ?? { count: 0, sumNative: 0 };
    statusSummary.count += 1;
    statusSummary.sumNative += toNumber(row.cut_native);
    byStatus.set(status, statusSummary);
  }

  return {
    count: rows.length,
    sumNative: money(totalNative),
    byStatus: Object.fromEntries(
      [...byStatus.entries()].map(([status, value]) => [
        status,
        { count: value.count, sumNative: money(value.sumNative) },
      ])
    ),
    byPair: [...byPair.values()].map((pair) => ({
      ...pair,
      sumNative: money(pair.sumNative),
    })),
  };
}

async function applyCandidates(rows) {
  let updated = 0;

  for (const row of rows) {
    const result = await prisma.commissionSplit.updateMany({
      where: {
        id: row.split_id,
        role: "TEACHER",
        teacherStudentId: null,
      },
      data: {
        teacherStudentId: row.relationship_id,
        teacherStudentSequence: row.relationship_sequence,
      },
    });
    updated += result.count;
  }

  return updated;
}

async function main() {
  const [candidates, skippedSummary] = await Promise.all([
    getCandidates(),
    getSkippedSummary(),
  ]);

  const summary = summarize(candidates);
  const report = {
    mode: APPLY ? "apply" : "dry-run",
    candidateSummary: summary,
    skippedSummary: skippedSummary.map((row) => ({
      reason: row.reason,
      count: row.count,
      sumNative: money(row.sum_native),
    })),
  };

  if (!APPLY) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const updated = await applyCandidates(candidates);
  console.log(JSON.stringify({ ...report, updated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
