import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractEventType,
  isCommissionConversionEvent,
} from "../src/lib/rewardful-webhook-parser.ts";

test("sale.created payloads are not treated as commission conversions", () => {
  const payload = {
    event: {
      type: "sale.created",
    },
    object: {
      id: "sale_123",
      sale_amount_cents: 7499,
      affiliate: { id: "affiliate_1" },
      charged_at: "2026-05-07T19:56:34.000Z",
    },
  };

  assert.equal(extractEventType(payload), "sale.created");
  assert.equal(isCommissionConversionEvent(extractEventType(payload)), false);
});

test("commission.created payloads are treated as commission conversions", () => {
  assert.equal(isCommissionConversionEvent("commission.created"), true);
  assert.equal(isCommissionConversionEvent("conversion.created"), true);
  assert.equal(isCommissionConversionEvent("referral.conversion"), true);
});
