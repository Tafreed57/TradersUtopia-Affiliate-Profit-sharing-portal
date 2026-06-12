import assert from "node:assert/strict";
import { test } from "node:test";

import { canClaimUpstreamPlaceholder } from "../src/lib/upstream-placeholder-account.ts";

test("upstream placeholders can be claimed during account creation", () => {
  assert.equal(
    canClaimUpstreamPlaceholder({
      passwordHash: null,
      rewardfulAffiliateId: "affiliate_123",
      accounts: [],
    }),
    true
  );
});

test("existing authenticated accounts cannot be claimed as placeholders", () => {
  assert.equal(
    canClaimUpstreamPlaceholder({
      passwordHash: "hashed-password",
      rewardfulAffiliateId: "affiliate_123",
      accounts: [],
    }),
    false
  );

  assert.equal(
    canClaimUpstreamPlaceholder({
      passwordHash: null,
      rewardfulAffiliateId: "affiliate_123",
      accounts: [{ id: "account_123" }],
    }),
    false
  );
});
