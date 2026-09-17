import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccessWorkRoute, isCommissionEligible, isWorkPortalUser, portalHome, safePortalDestination } from "../src/lib/account-access.ts";
import { decodeOnboardingIntent, encodeOnboardingIntent, onboardingCookie } from "../src/lib/onboarding-intent.ts";

test("Work access is restricted while admin access is separate from commission eligibility", () => {
  assert.equal(isWorkPortalUser({ accountType: "WORK" }), true);
  assert.equal(isWorkPortalUser({ accountType: "WORK", isAdmin: true }), false);
  assert.equal(isCommissionEligible({ accountType: "WORK" }), false);
  assert.equal(isCommissionEligible({ accountType: "COMMISSION" }), true);
  assert.equal(portalHome({ accountType: "WORK" }), "/attendance");
  assert.equal(portalHome({ accountType: "COMMISSION" }), "/");
});

test("Work routes allow only own operational surfaces and safe utilities", () => {
  for (const page of ["/attendance", "/promo-codes", "/settings", "/notifications"]) assert.equal(canAccessWorkRoute(page), true, page);
  for (const page of ["/", "/commissions", "/students", "/admin", "/attendance/other-user"]) assert.equal(canAccessWorkRoute(page), false, page);
  assert.equal(canAccessWorkRoute("/api/attendance", "POST"), true);
  assert.equal(canAccessWorkRoute("/api/promo-codes", "POST"), true);
  assert.equal(canAccessWorkRoute("/api/settings/profile", "GET"), true);
  for (const [path, method] of [
    ["/api/settings/profile", "PATCH"], ["/api/attendance", "DELETE"],
    ["/api/promo-codes/another-request/approve", "POST"], ["/api/dashboard/stats", "GET"],
    ["/api/me/backfill-status", "GET"], ["/api/students", "GET"], ["/api/users/search", "GET"],
    ["/api/internal/backfill", "POST"], ["/api/company/performance", "GET"],
    ["/api/commissions/lifetime-stats", "GET"], ["/api/currency", "GET"],
  ]) assert.equal(canAccessWorkRoute(path, method), false, `${method} ${path}`);
});

test("login destinations cannot escape the portal or grant Work access to earnings", () => {
  for (const destination of ["https://evil.example/", "//evil.example/", "/\\evil.example/", "/auth/complete", "/api/admin", "/work", "/commissions", "/students"]) {
    assert.equal(safePortalDestination(destination, { accountType: "WORK" }), "/attendance");
  }
  assert.equal(safePortalDestination("/promo-codes?created=1", { accountType: "WORK" }), "/promo-codes?created=1");
  assert.equal(safePortalDestination("/commissions", { accountType: "COMMISSION" }), "/commissions");
});

test("onboarding intent authenticates type and OAuth state and expires after 15 minutes", () => {
  const now = 10_000;
  const secret = "isolated-test-secret";
  const token = encodeOnboardingIntent("WORK", "oauth-attempt-one", secret, now);
  const decoded = decodeOnboardingIntent(token, secret, now + 1);
  assert.equal(decoded?.accountType, "WORK");
  assert.equal(decoded?.state, "oauth-attempt-one");
  assert.notEqual(decoded?.state, "another-attempt");
  assert.equal(decodeOnboardingIntent(token, "wrong-secret", now), null);
  assert.equal(decodeOnboardingIntent(token, secret, now + 900_000), null);
  assert.equal(decodeOnboardingIntent(undefined, secret, now), null);
  const [payload, signature] = token.split(".");
  const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
  changed.accountType = "COMMISSION";
  assert.equal(decodeOnboardingIntent(`${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`, secret, now), null);
  assert.match(onboardingCookie(token, true), /__Host-tu-onboarding=.*HttpOnly; SameSite=Lax; Max-Age=900; Secure$/);
  assert.match(onboardingCookie("", true, true), /Max-Age=0/);
});
