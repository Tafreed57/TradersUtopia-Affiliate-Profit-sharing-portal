// Exercise the actual admin list with every API request intercepted. The fixture
// route exists only during this run; database/upstream URLs are deliberately inert.
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { spawn } from "node:child_process";
import { chromium, expect, request } from "@playwright/test";

const fixtureDirectory = resolve("src/app/brand/account-access-verification");
const fixtureFile = join(fixtureDirectory, "page.tsx");
const sessionFixtureDirectory = join(fixtureDirectory, "session");
const sessionFixtureFile = join(sessionFixtureDirectory, "page.tsx");
const artifacts = resolve("test-results/account-access-ui");
const port = Number(process.env.ACCESS_UI_TEST_PORT || 3224);
const baseURL = `http://localhost:${port}`;
const session = { user: { id: "admin", name: "Test Admin", email: "admin@example.invalid", accountType: "COMMISSION", isAdmin: true }, expires: "2099-01-01T00:00:00Z" };
const affiliate = (id, name, overrides = {}) => ({
  id, name, email: `${id}@example.invalid`, image: null, status: "ACTIVE", canDeactivate: true,
  accountType: "COMMISSION", affiliateGroup: null, commissionPercent: 10,
  initialCommissionPercent: 10, recurringCommissionPercent: 10, canProposeRates: false,
  rewardfulAffiliateId: "fixture", linkError: null, backfillError: null,
  createdAt: "2026-01-01T00:00:00Z", commissionsCount: 0, studentsCount: 2, teachersCount: 0,
  ...overrides,
});
const affiliates = [affiliate("alpha", "Affiliate Alpha"), affiliate("worker", "Work Affiliate", { accountType: "WORK", studentsCount: 0 }), affiliate("admin", "Test Admin", { canDeactivate: false }), affiliate("other-admin", "Other Admin", { canDeactivate: false })];
const students = [
  { relationshipId: "direct", id: "student", name: "Direct Student", email: "student@example.invalid", depth: 1 },
  { relationshipId: "second", id: "second-student", name: "Second Student", email: "second@example.invalid", depth: 2 },
];
let app, browser, probe;
let createdFixture = false;
let createdSessionFixture = false;
let serverReady = false;
let serverOutput = "";
try {
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(fixtureFile, `"use client";
import { SessionProvider } from "next-auth/react";
import AdminPage from "@/app/(dashboard)/admin/page";
export default function VerificationPage() {
  return <SessionProvider session={${JSON.stringify(session)}}><main className="p-4"><AdminPage /></main></SessionProvider>;
}
`, { flag: "wx" });
  createdFixture = true;
  await mkdir(sessionFixtureDirectory, { recursive: true });
  await writeFile(sessionFixtureFile, `"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SessionProvider } from "@/providers/session-provider";
import { PortalShell } from "@/components/layout/portal-shell";
function SessionVerification() {
  const searchParams = useSearchParams();
  const accountType = searchParams.get("type") === "WORK" ? "WORK" : "COMMISSION";
  const session = { user: { id: "affiliate", name: "Test Affiliate", email: "affiliate@example.invalid", accountType, isAdmin: false }, expires: "2099-01-01T00:00:00Z" } as const;
  return <SessionProvider session={session}><PortalShell session={session}><p>Protected affiliate content</p></PortalShell></SessionProvider>;
}
export default function VerificationPage() { return <Suspense><SessionVerification /></Suspense>; }
`, { flag: "wx" });
  createdSessionFixture = true;
  await mkdir(artifacts, { recursive: true });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", String(port)], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env, DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/invalid", DIRECT_DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/invalid",
      NEXTAUTH_URL: baseURL, NEXTAUTH_SECRET: "mock-account-access-ui-only", ADMIN_EMAIL: "admin@example.invalid",
      REWARDFUL_API_KEY: "fixture", REWARDFUL_API_BASE_URL: "http://127.0.0.1:1", EXCHANGE_RATE_API_URL: "http://127.0.0.1:1",
      GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture", NEXT_PUBLIC_SENTRY_DSN: "", SENTRY_DSN: "", SENTRY_AUTH_TOKEN: "",
      FIREBASE_PRIVATE_KEY: "", FIREBASE_CLIENT_EMAIL: "", NEXT_TELEMETRY_DISABLED: "1", VERCEL: "", VERCEL_PROJECT_PRODUCTION_URL: "",
    },
  });
  app.stdout.on("data", chunk => { serverOutput = (serverOutput + chunk).slice(-30000); });
  app.stderr.on("data", chunk => { serverOutput = (serverOutput + chunk).slice(-30000); });
  probe = await request.newContext();
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    assert.equal(app.exitCode, null, serverOutput);
    try {
      if ((await probe.get(`${baseURL}/brand/account-access-verification`, { timeout: 120_000 })).ok()) { ready = true; break; }
    } catch (error) {
      if (attempt === 0) console.log(`Waiting for local app: ${error.message.split("\n")[0]}`);
    }
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(ready, serverOutput);
  serverReady = true;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const writes = [];
  let failPreview = false, failSave = false, previewProtected = false;
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname === "/api/auth/session") return route.fulfill({ json: session });
    if (pathname === "/api/currency") return route.fulfill({ json: { rate: 0.74, stale: false } });
    if (pathname === "/api/admin/affiliates") return route.fulfill({ json: { data: affiliates, pagination: { page: 1, limit: 50, total: affiliates.length, totalPages: 1 } } });
    if (pathname.startsWith("/api/admin/affiliates/")) {
      const target = affiliates.find(value => value.id === pathname.split("/").at(-1));
      assert.ok(target, pathname);
      if (method === "PATCH") {
        writes.push({ id: target.id, ...route.request().postDataJSON() });
        if (failSave) return route.fulfill({ status: 500, json: { error: "Could not change access. Try again." } });
        target.status = route.request().postDataJSON().status;
        return route.fulfill({ json: target });
      }
      if (failPreview) return route.fulfill({ status: 500, json: { error: "Unavailable" } });
      return route.fulfill({ json: { ...target, canDeactivate: !previewProtected && target.canDeactivate, students: target.accountType === "WORK" ? [] : students } });
    }
    if (pathname === "/api/admin/affiliate-groups") return route.fulfill({ json: { data: [], ungroupedCount: affiliates.length } });
    if (pathname === "/api/admin/diagnostics") return route.fulfill({ json: {} });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto(`${baseURL}/brand/account-access-verification`, { timeout: 120000 });
  const alphaButton = page.getByRole("button", { name: "Deactivate Affiliate Alpha", exact: true });
  await expect(alphaButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate Test Admin", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Deactivate Other Admin", exact: true })).toBeDisabled();
  await alphaButton.click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Deactivate and remove access", exact: true });
  await expect(confirm).toBeEnabled();
  await expect(dialog).toContainText("alpha@example.invalid");
  await expect(dialog).toContainText("Direct Student");
  await expect(dialog).toContainText("Second-level student");
  await page.screenshot({ path: join(artifacts, "deactivate-desktop.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(writes.length, 0);
  console.log("PASS direct list action, selected identity, both student levels, protected admins and cancel");

  failPreview = true;
  await alphaButton.click();
  await expect(dialog.getByRole("alert")).toContainText("Could not load account details");
  await expect(confirm).toBeDisabled();
  failPreview = false;
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(confirm).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  previewProtected = true;
  await alphaButton.click();
  await expect(dialog.getByRole("alert")).toContainText("administrator account cannot be deactivated");
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  previewProtected = false;
  console.log("PASS preview failure blocks save, retry recovers, freshly protected admin stays blocked");

  await alphaButton.click();
  await expect(confirm).toBeEnabled();
  failSave = true;
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText("Could not change access");
  await expect(dialog).toBeVisible();
  assert.equal(affiliates[0].status, "ACTIVE");
  failSave = false;
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Reactivate Affiliate Alpha", exact: true })).toBeVisible();
  assert.equal(affiliates[0].status, "DEACTIVATED");
  assert.deepEqual(writes.at(-1), { id: "alpha", status: "DEACTIVATED" });
  await page.getByRole("button", { name: "Reactivate Affiliate Alpha", exact: true }).click();
  await expect(dialog).toContainText("Previous teacher and student links stay disabled");
  await dialog.getByRole("button", { name: "Restore access", exact: true }).click();
  await expect(alphaButton).toBeVisible();
  assert.deepEqual(writes.at(-1), { id: "alpha", status: "ACTIVE" });
  console.log("PASS save failure remains reviewable, successful save refreshes list, reactivation restores access");

  await page.setViewportSize({ width: 375, height: 812 });
  await alphaButton.click();
  await expect(confirm).toBeEnabled();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 375 && bounds.y + bounds.height <= 812, JSON.stringify(bounds));
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeVisible();
  await page.screenshot({ path: join(artifacts, "deactivate-mobile.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Deactivate Work Affiliate", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Deactivate and remove access", exact: true })).toBeEnabled();
  await expect(dialog).not.toContainText("Linked students");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log("PASS phone viewport, reachable confirmation, Work confirmation, no browser runtime errors");

  // Exercise the real client provider and shell with an already signed-in tab.
  // Clock advancement verifies the poll without waiting half a minute per cohort.
  for (const { accountType, failedRefresh } of [
    { accountType: "COMMISSION", failedRefresh: false },
    { accountType: "WORK", failedRefresh: false },
    { accountType: "COMMISSION", failedRefresh: true },
  ]) {
    const sessionPage = await browser.newPage();
    await sessionPage.clock.install();
    let revoked = false;
    const signouts = [];
    const activeSession = { user: { id: "affiliate", name: "Test Affiliate", email: "affiliate@example.invalid", accountType, isAdmin: false }, expires: "2099-01-01T00:00:00Z" };
    await sessionPage.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/auth/session") {
        if (revoked && failedRefresh) return route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
        return route.fulfill({ json: revoked ? { ...activeSession, user: { ...activeSession.user, id: "" } } : activeSession });
      }
      if (pathname === "/api/auth/csrf") return route.fulfill({ json: { csrfToken: "session-check-token" } });
      if (pathname === "/api/auth/signout") {
        const callbackUrl = new URLSearchParams(route.request().postData()).get("callbackUrl");
        signouts.push(callbackUrl);
        return route.fulfill({ json: { url: `${baseURL}${callbackUrl}` } });
      }
      return route.fulfill({ json: {} });
    });
    await sessionPage.goto(`${baseURL}/brand/account-access-verification/session?type=${accountType}`, { timeout: 120000 });
    await expect(sessionPage.getByText("Protected affiliate content", { exact: true })).toBeVisible();
    await sessionPage.clock.fastForward(31_000);
    await expect(sessionPage.getByText("Protected affiliate content", { exact: true })).toBeVisible();
    assert.equal(signouts.length, 0);
    revoked = true;
    await sessionPage.clock.fastForward(31_000);
    const loginPath = accountType === "WORK" ? "/work" : "/login";
    await expect(sessionPage).toHaveURL(`${baseURL}${loginPath}${failedRefresh ? "" : "?error=AccountDeactivated"}`, { timeout: 120000 });
    await expect(sessionPage.getByText("Protected affiliate content", { exact: true })).not.toBeVisible();
    if (failedRefresh) {
      assert.deepEqual(signouts, [], "A temporary session-fetch failure must not delete a valid session cookie");
      await expect(sessionPage.getByText("Your account is no longer active.", { exact: false })).not.toBeVisible();
    } else {
      await expect(sessionPage.getByRole("alert")).toContainText("Your account is no longer active");
      assert.deepEqual(signouts, [`${loginPath}?error=AccountDeactivated`]);
    }
    await sessionPage.close();
  }
  console.log("PASS active tabs stay mounted and deactivated sessions sign out on the next poll for both account types");
  console.log("PASS a temporary session-refresh failure does not sign out an active account");
} finally {
  await browser?.close();
  await probe?.dispose();
  if (app && app.exitCode === null) {
    if (process.platform === "win32") {
      const stop = spawn("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await new Promise(done => stop.once("exit", done));
    } else app.kill();
    if (app.exitCode === null) {
      await Promise.race([new Promise(done => app.once("exit", done)), new Promise(done => setTimeout(done, 3000))]);
    }
  }
  if (createdSessionFixture) {
    assert.equal(sessionFixtureDirectory, resolve("src/app/brand/account-access-verification/session"));
    await rm(sessionFixtureFile);
    await rm(sessionFixtureDirectory, { recursive: false }).catch(() => {});
  }
  if (createdFixture) {
    assert.equal(fixtureDirectory, resolve("src/app/brand/account-access-verification"));
    await rm(fixtureFile);
    await rm(fixtureDirectory, { recursive: false }).catch(() => {});
  }
  if (serverReady) {
    // Do not leave generated imports pointing at the temporary fixture pages.
    const generatedTypes = resolve(".next/dev/types");
    assert.ok(generatedTypes.startsWith(`${resolve(".next")}${sep}`));
    await rm(generatedTypes, { recursive: true, force: true });
    const typegen = spawn(process.execPath, ["node_modules/next/dist/bin/next", "typegen"], {
      windowsHide: true, stdio: "inherit", env: { ...process.env, SENTRY_AUTH_TOKEN: "", NEXT_TELEMETRY_DISABLED: "1" },
    });
    const code = await new Promise((done, reject) => { typegen.once("error", reject); typegen.once("exit", done); });
    assert.equal(code, 0, "Regenerate clean route types after verification");
  }
}
