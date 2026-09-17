import assert from "node:assert/strict";
import { test } from "node:test";
import Decimal from "decimal.js";
import { loadAppModule } from "./load-app-module.mts";

type Engine = typeof import("../src/lib/commission-engine.ts");
type Catalog = typeof import("../src/lib/affiliate-sync-service.ts");
type Recalc = typeof import("../src/lib/recalc-pending.ts");
type Relationships = typeof import("../src/lib/teacher-student-relationships.ts");
type Backfill = typeof import("../src/lib/backfill-service.ts");
type Payments = typeof import("../src/lib/payment-service.ts");

function account(accountType: "WORK" | "COMMISSION", configured = true) {
  return { id: "affiliate", email: "test@example.com", accountType, status: "ACTIVE",
    initialCommissionPercent: new Decimal(accountType === "WORK" ? 1000 : 40),
    recurringCommissionPercent: new Decimal(accountType === "WORK" ? 1000 : 20),
    ratesConfiguredAt: configured ? new Date() : null };
}

type EventInput = { fullAmount: number; ceoCut: number; splits?: { create: Array<{ role: string; cutAmount: number }> } };
const conversion = { rewardfulCommissionId: "conversion", affiliateRewardfulId: "provider-affiliate", amount: 125.50,
  currency: "CAD", conversionDate: "2026-09-17T12:00:00Z", rawPayload: {} };
const noCad = { getCommissionCadAllocation: () => assert.fail("Work must not query currency allocations") };

for (const configured of [true, false]) {
  test(`webhook records Work pool with no splits even with invalid rates (configured=${configured})`, async () => {
    const records: EventInput[] = [];
    const { processConversion } = loadAppModule<Engine>("src/lib/commission-engine.ts", {
      "@/lib/prisma": { prisma: {
        user: { findFirst: async () => account("WORK", configured) },
        teacherStudent: { findMany: () => assert.fail("Work must not load teacher chain") },
        commissionEvent: { findUnique: async () => null, create: async ({ data }: { data: EventInput }) => {
          records.push(data); return { id: "event", splits: [] };
        } },
      } },
      "@/lib/commission-cad-service": noCad,
      "@/lib/notifications": { createNotifications: () => assert.fail("Work must not send commission notices") },
    });
    const result = await processConversion(conversion);
    assert.equal(result.success, true);
    assert.equal(result.commissionsCreated, 0);
    assert.equal(records[0].fullAmount, 125.50);
    assert.equal(records[0].ceoCut, 125.50);
    assert.equal(records[0].splits?.create.length, 0);
  });
}

test("commission webhook preserves affiliate and eligible teacher allocations", async () => {
  const records: EventInput[] = [];
  const { processConversion } = loadAppModule<Engine>("src/lib/commission-engine.ts", {
    "@/lib/prisma": { prisma: {
      user: { findFirst: async () => account("COMMISSION") },
      teacherStudent: { findMany: async ({ where }: { where: { teacher: { accountType: string } } }) => {
        assert.equal(where.teacher.accountType, "COMMISSION");
        return [{ id: "relationship", teacherId: "teacher", teacherCut: new Decimal(10), depth: 1, activationSequence: 1 }];
      } },
      commissionEvent: { findUnique: async () => null, create: async ({ data }: { data: EventInput }) => {
        records.push(data); return { id: "event", splits: [] };
      } },
    } },
    "@/lib/commission-cad-service": noCad,
    "@/lib/notifications": {},
  });
  const result = await processConversion(conversion, { notify: false });
  assert.equal(result.commissionsCreated, 2);
  assert.equal(records[0].splits?.create[0].cutAmount, 50.20);
  assert.equal(records[0].splits?.create[1].cutAmount, 12.55);
  assert.equal(records[0].ceoCut, 62.75);
});

test("bulk catalog imports Work sales but never inserts affiliate or teacher splits", async () => {
  const records: EventInput[] = [];
  const { syncAffiliateCommissionCatalog } = loadAppModule<Catalog>("src/lib/affiliate-sync-service.ts", {
    "@/lib/prisma": { prisma: {
      user: { findFirst: async () => account("WORK"), findUnique: async () => account("WORK") },
      teacherStudent: { findMany: async () => [{ id: "accidental-relation", teacherId: "teacher", teacherCut: new Decimal(1000), depth: 1, activationSequence: 1 }] },
      commissionEvent: { findMany: async () => [], createMany: async ({ data }: { data: EventInput[] }) => { records.push(...data); } },
      commissionSplit: { createMany: () => assert.fail("Work must never insert split rows") },
    } },
    "@/lib/commission-engine": {},
    "@/lib/commission-cad-service": noCad,
    "@/lib/paid-sync-service": { syncCommissionStatesFromCommissions: async () => ({ paidUpdated: 0, voidedUpdated: 0 }) },
    "@/lib/rewardful": {
      disableAffiliateCommissionNotificationEmails: async () => {},
      listAllCommissionsForAffiliate: async () => [{ id: "conversion", sale: { charged_at: conversion.conversionDate, currency: "CAD" } }],
      rewardfulCommissionBaseAmountCents: () => 12550,
      snapshotFromRewardfulCommission: () => ({ state: "pending", dueAt: null, paidAt: null, voidedAt: null, campaignId: "campaign", campaignName: "Campaign" }),
    },
  });
  const result = await syncAffiliateCommissionCatalog({ affiliateId: "affiliate", rewardfulAffiliateId: "provider-affiliate" });
  assert.equal(result.created, 1);
  assert.equal(records[0].fullAmount, 125.50);
  assert.equal(records[0].ceoCut, 125.50);
});

test("recalculation stops before querying or repricing Work splits", async () => {
  const { runRecalcPending } = loadAppModule<Recalc>("src/lib/recalc-pending.ts", {
    "@/lib/prisma": { prisma: { user: { findUnique: async () => account("WORK") } } },
  });
  const result = await runRecalcPending("affiliate", "admin");
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") assert.equal(result.updated, 0);
});

for (const workParticipant of ["teacher", "student"]) {
  test(`relationship activation rejects Work ${workParticipant} before any mutation`, async () => {
    const db = { user: { findMany: async () => [
      { id: "teacher", accountType: workParticipant === "teacher" ? "WORK" : "COMMISSION" },
      { id: "student", accountType: workParticipant === "student" ? "WORK" : "COMMISSION" },
    ] } };
    const { activateTeacherStudentRelationship } = loadAppModule<Relationships>("src/lib/teacher-student-relationships.ts", {
      "@/lib/prisma": { prisma: { $transaction: async (callback: (tx: typeof db) => Promise<unknown>) => callback(db) } },
      "@/lib/commission-cad-service": noCad,
    });
    await assert.rejects(activateTeacherStudentRelationship({ teacherId: "teacher", studentId: "student", actorId: "admin", teacherCut: 50 }), /Work accounts cannot be teachers or students/);
  });
}

test("Work historical backfill imports accounting events without requiring commission rates", async () => {
  let imported = 0;
  const { runBackfill } = loadAppModule<Backfill>("src/lib/backfill-service.ts", {
    "@/lib/prisma": { prisma: { user: {
      findUnique: async () => ({ ...account("WORK", false), rewardfulAffiliateId: "provider-affiliate" }),
      updateMany: async () => ({ count: 1 }), update: async () => ({}),
    } } },
    "@/lib/commission-engine": { processConversion: async (_conversion: unknown, options: { notify: boolean }) => {
      assert.equal(options.notify, false); imported++; return { success: true };
    } },
    "@/lib/paid-sync-service": { syncCommissionStatesFromCommissions: async () => ({}) },
    "@/lib/rewardful": {
      listAllCommissionsForAffiliate: async () => [{ id: "conversion", sale: { charged_at: conversion.conversionDate, currency: "CAD" } }],
      rewardfulCommissionBaseAmountCents: () => 12550,
      snapshotFromRewardfulCommission: () => ({}),
    },
  });
  const result = await runBackfill("affiliate");
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.imported, 1);
  assert.equal(imported, 1);
});

test("Work relationship historical backfill and restore stop before allocations or writes", async () => {
  const relationship = { id: "relationship", teacherId: "teacher", studentId: "student", status: "ACTIVE", teacherCut: new Decimal(10) };
  const db = {
    user: { findMany: async () => [{ id: "teacher", accountType: "COMMISSION" }, { id: "student", accountType: "WORK" }] },
    teacherStudent: { findUnique: async () => relationship },
    teacherStudentArchive: { findUnique: async () => relationship },
  };
  const { backfillUnpaidTeacherSplitsForRelationship, restoreTeacherStudentDirect } = loadAppModule<Relationships>("src/lib/teacher-student-relationships.ts", {
    "@/lib/prisma": { prisma: { ...db, $transaction: async (callback: (tx: typeof db) => Promise<unknown>) => callback(db) } },
    "@/lib/commission-cad-service": noCad,
  });
  await assert.rejects(backfillUnpaidTeacherSplitsForRelationship("relationship"), /Work accounts cannot be teachers or students/);
  await assert.rejects(restoreTeacherStudentDirect({ archiveId: "archive", reviewedById: "admin", backfillMode: "ALL" }), /Work accounts cannot be teachers or students/);
});

test("payment and void webhooks still update Work accounting events with no recipient splits", async () => {
  const updates: Array<{ upstreamState: string }> = [];
  const { handleCommissionPaid, handleCommissionVoided } = loadAppModule<Payments>("src/lib/payment-service.ts", {
    "@/lib/prisma": { prisma: { commissionEvent: {
      findUnique: async () => ({ id: "event", affiliateId: "work", splits: [] }),
      update: async ({ data }: { data: typeof updates[number] }) => { updates.push(data); },
    } } },
    "@/lib/commission-cache": {}, "@/lib/notifications": {},
  });
  assert.equal((await handleCommissionPaid("conversion", new Date())).updated, 0);
  assert.equal((await handleCommissionVoided("conversion", new Date())).updated, 0);
  assert.equal(updates[0].upstreamState, "paid");
  assert.equal(updates[1].upstreamState, "voided");
});
