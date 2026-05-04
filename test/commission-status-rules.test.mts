import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCommissionStatus } from "../src/lib/commission-status-rules.ts";

test("active affiliates earn configured commissions without attendance gating", () => {
  const result = resolveCommissionStatus({
    affiliateUserStatus: "ACTIVE",
    ratesConfigured: true,
  });

  assert.equal(result.affiliateStatus, "EARNED");
  assert.equal(result.affiliateForfeitedToCeo, false);
  assert.equal(result.affiliateReason, null);
  assert.equal(result.teacherStatus, "EARNED");
  assert.equal(result.teacherReason, null);
});

test("unset rates stay pending instead of becoming attendance forfeitures", () => {
  const result = resolveCommissionStatus({
    affiliateUserStatus: "ACTIVE",
    ratesConfigured: false,
  });

  assert.equal(result.affiliateStatus, "PENDING");
  assert.equal(result.affiliateForfeitedToCeo, false);
  assert.equal(result.affiliateReason, "rate_not_set");
  assert.equal(result.teacherStatus, "EARNED");
  assert.equal(result.teacherReason, null);
});

test("deactivated affiliates stay forfeited while teachers still earn", () => {
  const result = resolveCommissionStatus({
    affiliateUserStatus: "DEACTIVATED",
    ratesConfigured: true,
  });

  assert.equal(result.affiliateStatus, "FORFEITED");
  assert.equal(result.affiliateForfeitedToCeo, true);
  assert.equal(result.affiliateReason, "affiliate_deactivated");
  assert.equal(result.teacherStatus, "EARNED");
  assert.equal(result.teacherReason, null);
});
