import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.REWARDFUL_API_KEY = "test_secret";
process.env.REWARDFUL_API_BASE_URL = "https://api.example.test/v1";

const rewardful = await import("../src/lib/rewardful.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("createCoupon uses affiliate coupon endpoint with token form body", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init;
    return new Response(
      JSON.stringify({
        id: "coupon_1",
        token: "PROFIT",
        affiliate_id: "affiliate_1",
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const coupon = await rewardful.createCoupon({
    affiliate_id: "affiliate_1",
    code: "PROFIT",
  });

  assert.equal(seenUrl, "https://api.example.test/v1/affiliate_coupons");
  assert.equal(seenInit?.method, "POST");
  assert.equal(
    (seenInit?.body as URLSearchParams).toString(),
    "affiliate_id=affiliate_1&token=PROFIT"
  );
  assert.equal(
    (seenInit?.headers as Record<string, string>)["Content-Type"],
    "application/x-www-form-urlencoded"
  );
  assert.equal(coupon.id, "coupon_1");
  assert.equal(rewardful.couponCode(coupon), "PROFIT");
});

test("listCoupons uses affiliate coupon endpoint", async () => {
  let seenUrl = "";

  globalThis.fetch = (async (url: string | URL | Request) => {
    seenUrl = String(url);
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "coupon_1",
            token: "CRYPTO",
            archived: false,
            affiliate_id: "affiliate_1",
          },
        ],
        pagination: { next_page: null },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const result = await rewardful.listCoupons({
    affiliate_id: "affiliate_1",
    limit: 10,
  });

  assert.match(seenUrl, /\/affiliate_coupons\?/);
  assert.match(seenUrl, /affiliate_id=affiliate_1/);
  assert.match(seenUrl, /limit=10/);
  assert.equal(result.data[0].id, "coupon_1");
  assert.equal(rewardful.couponCode(result.data[0]), "CRYPTO");
});
