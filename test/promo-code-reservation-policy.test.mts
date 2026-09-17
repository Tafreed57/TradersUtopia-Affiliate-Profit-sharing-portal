import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseReservedRequest, PromoCodeConflict } from "../src/lib/promo-code-reservation-policy.ts";

const failed = { id: "request-1", requesterId: "owner-1", status: "FAILED" };

test("uncertain failed creation preserves owner and reuses request on retry", () => {
  assert.equal(chooseReservedRequest(failed, [], "owner-1"), failed);
  assert.throws(() => chooseReservedRequest(failed, [], "owner-2"), PromoCodeConflict);
});

test("existing teacher pending request is reserved until review", () => {
  const pending = { ...failed, status: "PENDING_TEACHER" };
  assert.equal(chooseReservedRequest(null, [pending], "owner-1"), pending);
  assert.throws(() => chooseReservedRequest(null, [pending], "owner-2"), PromoCodeConflict);
});

test("legacy duplicate active codes block every owner without discarding history", () => {
  const pending = { ...failed, status: "PENDING_TEACHER" };
  const other = { id: "request-2", requesterId: "owner-2", status: "CREATED" };
  assert.throws(() => chooseReservedRequest(null, [pending, other], "owner-1"), PromoCodeConflict);
  assert.throws(() => chooseReservedRequest(pending, [pending, other], "owner-2"), PromoCodeConflict);
});

test("a rejected or removed code can be reserved anew", () => {
  assert.equal(chooseReservedRequest({ ...failed, status: "REJECTED_TEACHER" }, [], "owner-2"), undefined);
});

test("conflicting active history cannot overwrite a failed reservation", () => {
  const active = { id: "request-2", requesterId: "owner-2", status: "CREATED" };
  assert.throws(() => chooseReservedRequest(failed, [active], "owner-1"), PromoCodeConflict);
});
