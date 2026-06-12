import assert from "node:assert/strict";
import { test } from "node:test";

import { selectPromoCodeCampaign } from "../src/lib/promo-code-campaign.ts";

const baseCampaign = {
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
  url: "https://example.com",
  commission_type: "percentage",
  reward_type: "percent" as const,
  private: false,
  commission_percent: 30,
  commission_amount_cents: null,
  commission_amount_currency: null,
  max_commission_period_months: null,
  max_commissions: null,
  days_before_referrals_expire: null,
  days_until_commissions_are_due: null,
  minimum_payout_cents: null,
  minimum_payout_currency: null,
  visitors: 0,
  leads: 0,
  conversions: 0,
  affiliates: 0,
};

test("promo-code campaign selection does not require a Stripe coupon id", () => {
  const selected = selectPromoCodeCampaign(
    [
      {
        ...baseCampaign,
        id: "campaign_default",
        name: "Website",
        default: true,
        stripe_coupon_id: null,
      },
    ],
    undefined
  );

  assert.equal(selected.id, "campaign_default");
  assert.equal(selected.name, "Website");
});

test("promo-code campaign selection honors an explicit campaign id", () => {
  const selected = selectPromoCodeCampaign(
    [
      {
        ...baseCampaign,
        id: "campaign_default",
        name: "Website",
        default: true,
        stripe_coupon_id: null,
      },
      {
        ...baseCampaign,
        id: "campaign_alt",
        name: "VIP",
        default: false,
        stripe_coupon_id: null,
      },
    ],
    "campaign_alt"
  );

  assert.equal(selected.id, "campaign_alt");
});
