import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModule } from "./load-app-module.mts";

type Row = {
  id: string; requesterId: string; proposedCode: string; status: string;
  rewardfulCouponId: string | null; createdAt: Date; [key: string]: unknown;
};
type Reservation = { code: string; requestId: string | null; leaseToken: string | null; leaseExpiresAt: Date | null };
type Predicate = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Predicate): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Predicate[]).some((branch) => matches(row, branch));
    if (value && typeof value === "object") {
      const comparison = value as { in?: unknown[]; equals?: unknown; not?: unknown; mode?: string };
      if (comparison.in) return comparison.in.includes(row[key]);
      if (Object.hasOwn(comparison, "not")) return row[key] !== comparison.not;
      if (Object.hasOwn(comparison, "equals")) return comparison.mode === "insensitive"
        ? String(row[key]).toUpperCase() === String(comparison.equals).toUpperCase() : row[key] === comparison.equals;
    }
    return row[key] === value;
  });
}

function fixture(status = "FAILED") {
  let rows: Row[] = [{ id: "request-1", requesterId: "owner-1", proposedCode: "TRADER", status, rewardfulCouponId: null, createdAt: new Date() }];
  let reservation: Reservation = { code: "TRADER", requestId: "request-1", leaseToken: null, leaseExpiresAt: null };
  const coupon = { id: "coupon-1", token: "TRADER", affiliate_id: "affiliate-1" };
  const state = {
    deletes: 0, providerExists: true, failDelete: false,
    list: async () => state.providerExists ? [coupon] : [],
  };
  class ProviderError extends Error { status: number; constructor(status: number) { super("Provider response"); this.status = status; } }
  const db = {
    $executeRaw: async () => 1,
    promoCodeReservation: {
      findUnique: async () => ({ ...reservation }),
      findUniqueOrThrow: async () => ({ ...reservation, request: rows.find((row) => row.id === reservation.requestId) ?? null }),
      update: async ({ data }: { data: Partial<Reservation> }) => { Object.assign(reservation, data); return { ...reservation }; },
      updateMany: async ({ where, data }: { where: Predicate; data: Partial<Reservation> }) => {
        if (!matches(reservation, where)) return { count: 0 };
        Object.assign(reservation, data); return { count: 1 };
      },
    },
    promoCodeRequest: {
      findMany: async ({ where }: { where: Predicate }) => rows.filter((row) => matches(row, where)),
      count: async ({ where }: { where: Predicate }) => rows.filter((row) => matches(row, where)).length,
      findUnique: async ({ where }: { where: Predicate }) => rows.find((row) => matches(row, where)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: Predicate }) => { const row = rows.find((row) => matches(row, where)); assert.ok(row); return row; },
      create: async ({ data }: { data: Partial<Row> }) => { const row = { id: `request-${rows.length + 1}`, createdAt: new Date(), ...data } as Row; rows.push(row); return row; },
      update: async ({ where, data }: { where: Predicate; data: Partial<Row> }) => {
        const row = rows.find((row) => matches(row, where)); assert.ok(row); Object.assign(row, data); return row;
      },
      updateMany: async ({ where, data }: { where: Predicate; data: Partial<Row> }) => {
        const selected = rows.filter((row) => matches(row, where));
        selected.forEach((row) => Object.assign(row, data)); return { count: selected.length };
      },
    },
  };
  const prisma = { ...db, $transaction: async <T,>(callback: (tx: typeof db) => Promise<T>) => {
    const beforeRows = structuredClone(rows);
    const beforeReservation = structuredClone(reservation);
    try { return await callback(db); } catch (error) { rows = beforeRows; reservation = beforeReservation; throw error; }
  } };
  const service = loadAppModule<{
    deleteOwnedPromoCode(args: { requesterId: string; reviewerId: string; couponId: string; code: string; reconcileUnlinkedRequest: boolean; providerAlreadyAbsent?: boolean }): Promise<void>;
    createReservedPromoCode(args: { request: Row; affiliateId: string }): Promise<{ result: string; request: Row }>;
    reservePromoCode(args: { requesterId: string; code: string; immediate: boolean }): Promise<unknown>;
    rejectReservedPromoCode(args: { requestId: string; reviewerId: string; reason: string | null }): Promise<unknown>;
  }>("src/lib/promo-code-service.ts", {
    "@/lib/prisma": { prisma },
    "@/lib/rewardful": {
      RewardfulApiError: ProviderError,
      deleteCoupon: async () => {
        state.deletes++;
        if (state.failDelete) throw new Error("Deletion response lost");
        if (!state.providerExists) throw new ProviderError(404);
        state.providerExists = false;
      },
      listAllCouponsForAffiliate: async () => state.list(),
      createCoupon: async () => { throw new Error("Deletion retry must not create a coupon"); },
    },
  });
  const remove = (reconcileUnlinkedRequest = true, providerAlreadyAbsent = false) => service.deleteOwnedPromoCode({
    requesterId: "owner-1", reviewerId: "admin", couponId: "coupon-1", code: "TRADER", reconcileUnlinkedRequest,
    providerAlreadyAbsent,
  });
  return { service, remove, state, coupon, rows: () => rows, reservation: () => reservation };
}

test("deletion reconciles uncertain owned creation by code before releasing its reservation", async () => {
  const f = fixture();
  await f.remove();
  assert.equal(f.rows()[0].rewardfulCouponId, "coupon-1");
  assert.equal(f.rows()[0].status, "REJECTED_TEACHER");
  assert.equal(f.rows()[0].rejectionReason, "Removed by admin");
  assert.equal(f.reservation().requestId, null);
  assert.equal(f.state.deletes, 1);
});

test("active creation lease blocks deletion before provider mutation", async () => {
  const f = fixture("CREATING");
  Object.assign(f.reservation(), { leaseToken: "creator", leaseExpiresAt: new Date(Date.now() + 60_000) });
  await assert.rejects(f.remove(), /being updated/);
  assert.equal(f.state.deletes, 0);
  assert.equal(f.rows()[0].rewardfulCouponId, null);
});

test("stale creator cannot restore CREATED after fenced deletion", async () => {
  const f = fixture();
  let release!: (coupons: typeof f.coupon[]) => void;
  let signal!: () => void;
  const reachedProvider = new Promise<void>((resolve) => { signal = resolve; });
  f.state.list = async () => { signal(); return new Promise((resolve) => { release = resolve; }); };
  const creation = f.service.createReservedPromoCode({ request: f.rows()[0], affiliateId: "affiliate-1" });
  await reachedProvider;
  f.reservation().leaseExpiresAt = new Date(Date.now() - 1);
  await f.remove();
  release([f.coupon]);
  await creation;
  assert.equal(f.rows()[0].status, "REJECTED_TEACHER");
  assert.equal(f.reservation().leaseToken, null);
  assert.equal(f.state.providerExists, false);
});

test("stale creator cannot recreate a deleted code after its slow list returns empty", async () => {
  const f = fixture();
  let release!: (coupons: typeof f.coupon[]) => void;
  let signal!: () => void;
  const reachedProvider = new Promise<void>((resolve) => { signal = resolve; });
  f.state.list = async () => { signal(); return new Promise((resolve) => { release = resolve; }); };
  const creation = f.service.createReservedPromoCode({ request: f.rows()[0], affiliateId: "affiliate-1" });
  await reachedProvider;
  f.reservation().leaseExpiresAt = new Date(Date.now() - 1);
  await f.remove();
  // The stale operation's attempted create is stopped by the persisted fence;
  // the reconciliation read after that also returns no coupon.
  f.state.list = async () => [];
  release([]);
  await creation;
  assert.equal(f.rows()[0].status, "REJECTED_TEACHER");
  assert.equal(f.state.providerExists, false);
});

test("uncertain deletion retains a fence and supports confirmed-absence retry", async () => {
  const f = fixture();
  f.state.failDelete = true;
  await assert.rejects(f.remove(), /response lost/);
  assert.match(f.reservation().leaseToken!, /^delete:/);
  assert.equal(f.rows()[0].rewardfulCouponId, "coupon-1");
  const retryCreate = await f.service.createReservedPromoCode({ request: f.rows()[0], affiliateId: "affiliate-1" });
  assert.equal(retryCreate.result, "unavailable");
  f.state.failDelete = false;
  f.state.providerExists = false;
  await f.remove(false);
  assert.equal(f.rows()[0].status, "REJECTED_TEACHER");
  assert.equal(f.reservation().requestId, null);
});

test("deletion never clears another owner's reservation or audit rows", async () => {
  const f = fixture();
  f.rows()[0].requesterId = "owner-2";
  await assert.rejects(f.remove(), /conflicting request/);
  assert.equal(f.reservation().requestId, "request-1");
  assert.equal(f.rows()[0].status, "FAILED");
  assert.equal(f.state.deletes, 0);
});

test("only the verified owner's matching null-ID rows are reconciled", async () => {
  const f = fixture();
  f.rows().push({ id: "foreign-history", requesterId: "owner-2", proposedCode: "TRADER", status: "FAILED", rewardfulCouponId: null, createdAt: new Date() });
  await f.remove();
  assert.equal(f.rows()[0].status, "REJECTED_TEACHER");
  assert.equal(f.rows()[1].status, "FAILED");
  assert.equal(f.rows()[1].rewardfulCouponId, null);
});

test("historical local ownership never authorizes deleting a code absent from the current affiliate", async () => {
  const f = fixture("CREATED");
  f.rows()[0].rewardfulCouponId = "coupon-1";
  await f.remove(false, true);
  assert.equal(f.state.deletes, 0);
  assert.equal(f.state.providerExists, true);
  assert.equal(f.rows()[0].status, "REJECTED_TEACHER");
});

test("teacher rejection cannot clear an uncertain deletion fence on a pending request", async () => {
  const f = fixture("PENDING_TEACHER");
  f.state.failDelete = true;
  await assert.rejects(f.remove(), /response lost/);
  await assert.rejects(f.service.rejectReservedPromoCode({ requestId: "request-1", reviewerId: "teacher", reason: null }), /removal must be completed/);
  assert.match(f.reservation().leaseToken!, /^delete:/);
  assert.equal(f.rows()[0].status, "PENDING_TEACHER");
});

test("new requests cannot clear a historical rejected row's deletion fence", async () => {
  const f = fixture("REJECTED_TEACHER");
  f.rows()[0].rewardfulCouponId = "coupon-1";
  f.state.failDelete = true;
  await assert.rejects(f.remove(false), /response lost/);
  await assert.rejects(f.service.reservePromoCode({ requesterId: "owner-2", code: "TRADER", immediate: true }), /being removed/);
  assert.match(f.reservation().leaseToken!, /^delete:/);
  assert.equal(f.reservation().requestId, "request-1");
  assert.equal(f.rows().length, 1);
});
