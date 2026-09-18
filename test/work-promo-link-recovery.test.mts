import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModule } from "./load-app-module.mts";

function fixture(recover: boolean) {
  let affiliateId: string | null = null;
  let linkCalls = 0;
  let creations = 0;
  let reservations = 0;
  const route = loadAppModule<{ POST(req: Request): Promise<Response> }>("src/app/api/promo-codes/route.ts", {
    "next-auth": { getServerSession: async () => ({ user: { id: "work-user", email: "stale-session@example.test" } }) },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/auth-options": { authOptions: {} },
    "@/lib/constants": { PROMO_CODE_MIN_LENGTH: 4, PROMO_CODE_MAX_LENGTH: 6 },
    "@/lib/notifications": { createNotification: async () => {}, createNotifications: async () => [] },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => ({
      accountType: "WORK", status: "ACTIVE", rewardfulAffiliateId: affiliateId,
      email: "saved@example.test", name: "Saved Name",
    }) } } },
    "@/lib/auth-rewardful-link": { linkRewardfulAffiliateWithTimeout: async (args: { userId: string; email: string; name: string }) => {
      linkCalls++;
      assert.equal(args.userId, "work-user");
      assert.equal(args.email, "saved@example.test");
      assert.equal(args.name, "Saved Name");
      if (recover) affiliateId = "private-upstream-id";
    } },
    "@/lib/promo-code-service": {
      PromoCodeConflict: class extends Error {},
      reservePromoCode: async () => { reservations++; return { request: { id: "local-request", proposedCode: "TRADE" }, isNew: true }; },
      createReservedPromoCode: async (args: { affiliateId: string }) => {
        creations++;
        assert.equal(args.affiliateId, "private-upstream-id");
        return { result: "created", request: { id: "local-request", proposedCode: "TRADE", status: "CREATED" } };
      },
      workPromoCodeDto: (request: unknown) => request,
    },
    "@/lib/rewardful": {},
  });
  const submit = () => route.POST(new Request("http://portal.test/api/promo-codes", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposedCode: "trade" }),
  }));
  return { submit, counts: () => ({ linkCalls, creations, reservations }) };
}

test("Work Create recovers an interrupted account link and proceeds without signing in again", async () => {
  const f = fixture(true);
  const response = await f.submit();
  assert.equal(response.status, 201);
  const body = await response.text();
  assert.match(body, /CREATED/);
  assert.doesNotMatch(body, /private-upstream-id|saved@example|rewardful/i);
  assert.deepEqual(f.counts(), { linkCalls: 1, creations: 1, reservations: 1 });
});

test("pending Work account link returns a neutral retry message without reserving a code", async () => {
  const f = fixture(false);
  const response = await f.submit();
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Your account is getting ready. Try again shortly." });
  assert.deepEqual(f.counts(), { linkCalls: 1, creations: 0, reservations: 0 });
});
