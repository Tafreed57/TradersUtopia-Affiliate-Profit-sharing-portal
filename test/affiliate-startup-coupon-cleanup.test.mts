import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findLikelySignupAutoCoupons,
  signupCouponTokenCandidates,
} from "../src/lib/affiliate-startup-coupon-cleanup.ts";

test("signup coupon cleanup recognizes first-name and email-local startup tokens", () => {
  assert.deepEqual(
    signupCouponTokenCandidates({
      firstName: "Linda",
      email: "linda.trader@example.com",
    }),
    ["LINDA", "LINDATRADER"]
  );
});

test("signup coupon cleanup selects only unused generated-looking coupons", () => {
  const candidates = findLikelySignupAutoCoupons({
    firstName: "Linda",
    email: "linda@example.com",
    coupons: [
      { id: "coupon_first_name", token: "LINDA", leads: 0, conversions: 0 },
      { id: "coupon_duplicate", token: "LINDA2", leads: 0, conversions: 0 },
      { id: "coupon_used", token: "LINDA3", leads: 1, conversions: 0 },
      { id: "coupon_custom", token: "PROFIT", leads: 0, conversions: 0 },
    ],
  });

  assert.deepEqual(
    candidates.map((coupon) => coupon.id),
    ["coupon_first_name", "coupon_duplicate"]
  );
});
