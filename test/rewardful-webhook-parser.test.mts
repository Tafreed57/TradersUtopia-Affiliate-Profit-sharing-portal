import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractConversion,
  extractReferralLead,
  extractEventType,
  isCommissionConversionEvent,
  isReferralLeadEvent,
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

test("referral.lead payloads are recognized and extract stable recipient ids", () => {
  const payload = {
    event: { type: "referral.lead" },
    object: {
      id: "referral_123",
      affiliate: { id: "affiliate_456" },
    },
  };

  assert.equal(isReferralLeadEvent(extractEventType(payload)), true);
  assert.deepEqual(extractReferralLead(payload), {
    referralId: "referral_123",
    affiliateRewardfulId: "affiliate_456",
  });
});

test("non-lead referral payloads are ignored", () => {
  assert.equal(isReferralLeadEvent("referral.converted"), false);
  assert.equal(
    extractReferralLead({ event: { type: "referral.lead" }, object: { id: "ref" } }),
    null
  );
});

test("extractConversion keeps the stable commission amount after a full refund", () => {
  const parsed = extractConversion({
    event: { type: "commission.updated" },
    object: {
      id: "comm_paid_refund",
      amount: 7499,
      currency: "USD",
      state: "paid",
      paid_at: "2026-04-12T23:22:41.467Z",
      sale: {
        sale_amount_cents: 0,
        charge_amount_cents: 7499,
        refund_amount_cents: 7499,
        refund: "full",
        currency: "USD",
        charged_at: "2026-04-09T15:26:54.000Z",
        affiliate: { id: "aff_1" },
      },
    },
  });

  assert.equal(parsed?.amount, 74.99);
});
