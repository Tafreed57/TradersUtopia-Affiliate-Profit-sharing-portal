import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { loadAppModule } from "./load-app-module.mts";

type Route = typeof import("../src/app/api/admin/affiliates/[id]/route.ts");
type Session = { user: { id: string; isAdmin: boolean } } | null;
const context = (id = "affiliate") => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) => ({ json: async () => body }) as Parameters<Route["PATCH"]>[0];

function fixture(session: Session = { user: { id: "admin", isAdmin: true } }) {
  const state = {
    user: {
      id: "affiliate", email: "affiliate@example.test", accountType: "COMMISSION",
      status: "ACTIVE", ratesConfiguredAt: new Date(), ratesLocked: true,
      initialCommissionPercent: new Prisma.Decimal(0), recurringCommissionPercent: new Prisma.Decimal(0),
      canSeeRecurringCommissions: false, recurringCommissionsVisibleFrom: null,
      backfillStatus: "COMPLETED", rewardfulAffiliateId: null,
    },
    missing: false, reads: 0, writes: 0, transactions: 0, inTransaction: false,
    relationUpdates: [] as unknown[], sessionDeletes: [] as unknown[], notices: [] as unknown[],
    failAt: "" as "" | "user" | "relationships" | "sessions" | "notification",
  };
  const db = {
    user: {
      findUnique: async () => { state.reads++; return state.missing ? null : { ...state.user }; },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        assert.equal(where.id, state.user.id);
        if (data.status === "DEACTIVATED") assert.equal(state.inTransaction, true);
        if (state.failAt === "user") throw new Error("User update unavailable");
        Object.assign(state.user, data); state.writes++;
        return { ...state.user };
      },
    },
    teacherStudent: { updateMany: async (args: unknown) => {
      assert.equal(state.inTransaction, true);
      if (state.failAt === "relationships") throw new Error("Relationships unavailable");
      state.relationUpdates.push(args); return { count: 2 };
    } },
    session: { deleteMany: async (args: unknown) => {
      assert.equal(state.inTransaction, true);
      if (state.failAt === "sessions") throw new Error("Sessions unavailable");
      state.sessionDeletes.push(args); return { count: 1 };
    } },
  };
  const prisma = { ...db, $transaction: async (callback: (tx: typeof db) => Promise<unknown>) => {
    const before = { user: { ...state.user }, writes: state.writes, relations: [...state.relationUpdates], sessions: [...state.sessionDeletes] };
    state.transactions++; state.inTransaction = true;
    try { return await callback(db); }
    catch (error) {
      state.user = before.user; state.writes = before.writes;
      state.relationUpdates = before.relations; state.sessionDeletes = before.sessions;
      throw error;
    } finally { state.inTransaction = false; }
  } };
  const route = loadAppModule<Route>("src/app/api/admin/affiliates/[id]/route.ts", {
    "next-auth": { getServerSession: async () => session },
    "@/lib/auth-options": { authOptions: {} }, "@/lib/prisma": { prisma },
    "@/lib/constants": { isAdminEmail: (email: string) => email?.toLowerCase() === "admin@example.test", TEACHER_CUT_WARN_THRESHOLD: 85 },
    "@/lib/backfill-service": {}, "@/lib/commission-cad-service": {}, "@/lib/recalc-pending": {},
    "@/lib/notifications": { createNotification: async (args: unknown) => {
      assert.equal(state.inTransaction, false, "notice is sent only after commit");
      assert.equal(state.user.status, "DEACTIVATED");
      if (state.failAt === "notification") throw new Error("Notification unavailable");
      state.notices.push(args);
    } },
  });
  return { ...route, state };
}

for (const session of [null, { user: { id: "regular", isAdmin: false } }]) {
  test(`account access changes reject ${session ? "regular users" : "anonymous callers"} before reading data`, async () => {
    const f = fixture(session);
    assert.equal((await f.PATCH(request({ status: "DEACTIVATED" }), context())).status, 403);
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.writes, 0);
  });
}

test("self and other administrator deactivation are rejected before any settings change", async () => {
  for (const self of [true, false]) {
    const f = fixture(self ? { user: { id: "affiliate", isAdmin: true } } : undefined);
    if (!self) f.state.user.email = "Admin@Example.Test";
    const response = await f.PATCH(request({ status: "DEACTIVATED", initialCommissionPercent: 80 }), context());
    assert.equal(response.status, 403);
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.transactions, 0);
    assert.equal(f.state.notices.length, 0);
  }
});

for (const accountType of ["COMMISSION", "WORK"]) {
  test(`deactivation atomically blocks a ${accountType} account and clears sessions and its relationships`, async () => {
    const f = fixture(); f.state.user.accountType = accountType;
    const response = await f.PATCH(request({ status: "DEACTIVATED" }), context());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "DEACTIVATED");
    assert.equal(f.state.user.status, "DEACTIVATED");
    assert.equal(f.state.transactions, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.sessionDeletes)), [{ where: { userId: "affiliate" } }]);
    const update = JSON.parse(JSON.stringify(f.state.relationUpdates[0]));
    assert.deepEqual(update.where, { OR: [{ teacherId: "affiliate" }, { studentId: "affiliate" }], status: { in: ["PENDING", "ACTIVE"] } });
    assert.equal(update.data.status, "DEACTIVATED");
    assert.ok(Number.isFinite(Date.parse(update.data.deactivatedAt)));
    assert.equal(f.state.notices.length, 1);
    assert.equal(f.state.user.initialCommissionPercent.toNumber(), 0);
  });
}

test("notification failure cannot undo or report failure for successful access revocation", async () => {
  const f = fixture(); f.state.failAt = "notification";
  assert.equal((await f.PATCH(request({ status: "DEACTIVATED" }), context())).status, 200);
  assert.equal(f.state.user.status, "DEACTIVATED");
  assert.equal(f.state.sessionDeletes.length, 1);
});

for (const failAt of ["user", "relationships", "sessions"] as const) {
  test(`${failAt} failure rolls back deactivation and does not send a false success notice`, async () => {
    const f = fixture(); f.state.failAt = failAt;
    assert.equal((await f.PATCH(request({ status: "DEACTIVATED" }), context())).status, 500);
    assert.equal(f.state.user.status, "ACTIVE");
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.relationUpdates.length, 0);
    assert.equal(f.state.sessionDeletes.length, 0);
    assert.equal(f.state.notices.length, 0);
  });
}

test("repeated deactivation sends no duplicate notice and reactivation does not silently restore relationships", async () => {
  const f = fixture();
  await f.PATCH(request({ status: "DEACTIVATED" }), context());
  assert.equal((await f.PATCH(request({ status: "DEACTIVATED" }), context())).status, 200);
  assert.equal(f.state.notices.length, 1);
  const relationWrites = f.state.relationUpdates.length;
  assert.equal((await f.PATCH(request({ status: "ACTIVE" }), context())).status, 200);
  assert.equal(f.state.user.status, "ACTIVE");
  assert.equal(f.state.relationUpdates.length, relationWrites);
});

test("missing accounts and invalid statuses cannot mutate access", async () => {
  const f = fixture(); f.state.missing = true;
  assert.equal((await f.PATCH(request({ status: "DEACTIVATED" }), context())).status, 404);
  assert.equal((await f.PATCH(request({ status: "DELETED" }), context())).status, 400);
  assert.equal(f.state.writes, 0);
});
