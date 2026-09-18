import assert from "node:assert/strict";
import { test } from "node:test";

import { rewardfulCommissionBaseAmountCents } from "../src/lib/rewardful.ts";

test("stable commission amount wins when a paid sale is later fully refunded", () => {
  assert.equal(
    rewardfulCommissionBaseAmountCents({
      amount: 7499,
      sale: { sale_amount_cents: 0 },
    }),
    7499
  );
});

test("sale amount remains a fallback for payloads without a commission amount", () => {
  assert.equal(
    rewardfulCommissionBaseAmountCents({
      amount: undefined,
      sale: { sale_amount_cents: 10000 },
    }),
    10000
  );
});
