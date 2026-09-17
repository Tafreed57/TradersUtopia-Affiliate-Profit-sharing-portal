import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModule } from "./load-app-module.mts";

type AdminUpdate = typeof import("../src/app/api/admin/affiliates/[id]/route.ts");
type AdminLock = typeof import("../src/app/api/admin/affiliates/[id]/lock/route.ts");
type TestSetup = typeof import("../src/app/api/admin/test-setup/route.ts");
type TeacherBackfill = typeof import("../src/app/api/admin/teacher-proposals/backfill/route.ts");
type Reconcile = typeof import("../src/app/api/cron/reconcile/route.ts");

const sessionMocks = {
  "next-auth": { getServerSession: async () => ({ user: { id: "admin", isAdmin: true } }) },
  "@/lib/auth-options": { authOptions: {} },
};
const workDb = { user: { findUnique: async () => ({ id: "work", accountType: "WORK" }) } };

test("admin cannot configure rates, teacher flags or recurring visibility on a Work account", async () => {
  const { PATCH } = loadAppModule<AdminUpdate>("src/app/api/admin/affiliates/[id]/route.ts", {
    ...sessionMocks, "@/lib/prisma": { prisma: workDb },
    "@/lib/backfill-service": {}, "@/lib/commission-cad-service": {}, "@/lib/notifications": {}, "@/lib/recalc-pending": {},
  });
  for (const body of [{ initialCommissionPercent: 20 }, { recurringCommissionPercent: 30 }, { canBeTeacher: true }, { canProposeRates: true }, { canSeeRecurringCommissions: true }]) {
    const response = await PATCH({ json: async () => body } as Parameters<typeof PATCH>[0], { params: Promise.resolve({ id: "work" }) });
    assert.equal(response.status, 403, JSON.stringify(body));
  }
});

test("admin rate-lock and test-setup endpoints reject Work targets before mutations", async () => {
  const { PATCH } = loadAppModule<AdminLock>("src/app/api/admin/affiliates/[id]/lock/route.ts", {
    ...sessionMocks, "@/lib/prisma": { prisma: workDb },
  });
  assert.equal((await PATCH({ json: async () => ({ locked: true }) } as Parameters<typeof PATCH>[0], { params: Promise.resolve({ id: "work" }) })).status, 403);
  const { POST } = loadAppModule<TestSetup>("src/app/api/admin/test-setup/route.ts", {
    ...sessionMocks, "@/lib/prisma": { prisma: workDb }, "@/lib/backfill-service": {}, "@/lib/paid-sync-service": {},
  });
  assert.equal((await POST({ json: async () => ({ email: "work@example.com", initialRate: 50, recurringRate: 50 }) } as Parameters<typeof POST>[0])).status, 403);
});

test("legacy teacher backfill query excludes Work at both ends of a relationship", async () => {
  const { POST } = loadAppModule<TeacherBackfill>("src/app/api/admin/teacher-proposals/backfill/route.ts", {
    ...sessionMocks, "@/lib/prisma": { prisma: { teacherStudent: { findMany: async ({ where }: { where: { teacher: { accountType: string }; student: { accountType: string } } }) => {
      assert.equal(where.teacher.accountType, "COMMISSION");
      assert.equal(where.student.accountType, "COMMISSION");
      return [];
    } } } },
  });
  const response = await POST();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).created, 0);
});

test("reconciliation repairs Work classification without assigning any recipient amount", async () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-only-cron-secret";
  try {
    const updates: Array<{ isRecurring: boolean; ceoCut: number }> = [];
    let userReads = 0;
    const { GET } = loadAppModule<Reconcile>("src/app/api/cron/reconcile/route.ts", {
      "@/lib/affiliate-sync-service": {},
      "@/lib/prisma": { prisma: {
        user: { findMany: async () => ++userReads === 1 ? [] : [{ id: "work", accountType: "WORK" }], updateMany: async () => ({ count: 1 }) },
        commissionEvent: {
          findMany: async () => [{ id: "event", affiliateId: "work", rewardfulReferralId: "referral", conversionDate: new Date(), createdAt: new Date(), isRecurring: true, fullAmount: 125.50 }],
          update: async ({ data }: { data: typeof updates[number] }) => { updates.push(data); },
        },
        commissionSplit: { findMany: async () => [] },
      } },
    });
    const response = await GET({ headers: new Headers({ authorization: "Bearer test-only-cron-secret" }) } as Parameters<typeof GET>[0]);
    const result = await response.json();
    assert.equal(result.errors, 0);
    assert.equal(result.classificationFlipped, 1);
    assert.equal(result.classificationRepriced, 0);
    assert.equal(updates[0].ceoCut, 125.50);
    assert.equal(updates[0].isRecurring, false);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});
