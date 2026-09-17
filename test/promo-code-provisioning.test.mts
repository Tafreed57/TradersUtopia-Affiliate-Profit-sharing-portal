import assert from "node:assert/strict";
import { test } from "node:test";
import {
  provisionPromoCode,
  type PromoProvisioningDependencies,
  type ProvisioningCoupon,
} from "../src/lib/promo-code-provisioning.ts";

function fixture() {
  const state = {
    lease: null as string | null,
    created: false,
    createCalls: 0,
    failures: 0,
    coupons: [] as ProvisioningCoupon[],
    savedCoupon: null as ProvisioningCoupon | null,
  };
  const dependencies: PromoProvisioningDependencies = {
    claim: async () => {
      if (state.created) return { kind: "created" };
      if (state.lease) return { kind: "busy" };
      state.lease = "attempt-1";
      return { kind: "claimed", token: state.lease };
    },
    list: async () => state.coupons,
    create: async () => {
      state.createCalls++;
      const coupon = { id: "coupon-1", token: "TRADER", affiliate_id: "affiliate-1" };
      state.coupons.push(coupon);
      return coupon;
    },
    complete: async (token, coupon) => {
      if (state.lease !== token) return false;
      state.created = true;
      state.savedCoupon = coupon;
      state.lease = null;
      return true;
    },
    fail: async (token) => {
      if (state.lease !== token) return;
      state.failures++;
      state.lease = null;
    },
  };
  return { state, dependencies };
}

test("concurrent create requests produce one provider write", async () => {
  const { state, dependencies } = fixture();
  const results = await Promise.all([
    provisionPromoCode("TRADER", "affiliate-1", dependencies),
    provisionPromoCode("TRADER", "affiliate-1", dependencies),
  ]);
  assert.deepEqual(results.sort(), ["busy", "created"]);
  assert.equal(state.createCalls, 1);
});

test("same request replay returns completed result without provider creation", async () => {
  const { state, dependencies } = fixture();
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "created");
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "created");
  assert.equal(state.createCalls, 1);
});

test("lost provider response is reconciled from the owner's coupon list", async () => {
  const { state, dependencies } = fixture();
  const create = dependencies.create;
  dependencies.create = async () => {
    await create();
    throw new Error("Response timed out after provider committed");
  };
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "created");
  assert.equal(state.failures, 0);
  assert.equal(state.savedCoupon?.id, "coupon-1");
});

test("retry repairs provider success followed by local write failure", async () => {
  const { state, dependencies } = fixture();
  const complete = dependencies.complete;
  dependencies.complete = async () => { throw new Error("Database unavailable"); };
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "failed");
  dependencies.complete = complete;
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "created");
  assert.equal(state.createCalls, 1);
  assert.equal(state.failures, 1);
});

test("collision cannot adopt another affiliate's coupon", async () => {
  const { state, dependencies } = fixture();
  state.coupons.push({ id: "someone-elses-code", token: "TRADER", affiliate_id: "affiliate-other" });
  dependencies.create = async () => { throw new Error("Code unavailable"); };
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "failed");
  assert.equal(state.savedCoupon, null);
});

test("archived codes are not repaired as active", async () => {
  const { state, dependencies } = fixture();
  state.coupons.push({ id: "archived-code", token: "TRADER", affiliate_id: "affiliate-1", archived: true });
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "created");
  assert.equal(state.createCalls, 1);
  assert.equal(state.savedCoupon?.id, "coupon-1");
});

test("expired attempt cannot overwrite a replacement lease", async () => {
  const { state, dependencies } = fixture();
  const create = dependencies.create;
  dependencies.create = async () => {
    const coupon = await create();
    state.lease = "replacement-attempt";
    return coupon;
  };
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "busy");
  assert.equal(state.savedCoupon, null);
  assert.equal(state.lease, "replacement-attempt");
});

test("unavailable claim never contacts provider", async () => {
  const { state, dependencies } = fixture();
  dependencies.claim = async () => ({ kind: "unavailable" });
  dependencies.list = async () => { throw new Error("Must not contact provider"); };
  assert.equal(await provisionPromoCode("TRADER", "affiliate-1", dependencies), "unavailable");
  assert.equal(state.createCalls, 0);
});
