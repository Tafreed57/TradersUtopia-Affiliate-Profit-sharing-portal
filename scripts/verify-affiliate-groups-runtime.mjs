// All mutations run in a generated disposable PostgreSQL schema. The external
// affiliate integration is replaced by a local fixture server for this process.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { request, chromium, expect } from "@playwright/test";

try { process.loadEnvFile(".env"); } catch { /* CI supplies environment. */ }
const schemaName = `groups_verify_${randomUUID().replaceAll("-", "")}`;
assert.match(schemaName, /^groups_verify_[a-f0-9]{32}$/);
const databaseUrl = new URL(process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL);
databaseUrl.searchParams.set("schema", schemaName);
const testUrl = databaseUrl.toString();
const db = new PrismaClient({ datasourceUrl: testUrl });
const temporary = await mkdtemp(join(tmpdir(), "tu-groups-runtime-"));
const artifacts = resolve("test-results/affiliate-groups-runtime");
await mkdir(artifacts, { recursive: true });
const contexts = [];
let app, browser;
let output = "";
const provider = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: [], rates: { USD: 0.74 } }));
});
await new Promise(ready => provider.listen(0, "127.0.0.1", ready));
const providerURL = `http://127.0.0.1:${provider.address().port}`;
const port = Number(process.env.GROUP_TEST_PORT || 3218);
const baseURL = `http://localhost:${port}`;
const env = {
  ...process.env, DATABASE_URL: testUrl, DIRECT_DATABASE_URL: testUrl,
  NEXTAUTH_URL: baseURL, NEXTAUTH_SECRET: "isolated-groups-runtime-secret",
  ADMIN_EMAIL: "admin@groups-runtime.invalid", REWARDFUL_API_KEY: "local-fixture",
  REWARDFUL_API_BASE_URL: providerURL, EXCHANGE_RATE_API_URL: providerURL,
  GOOGLE_CLIENT_ID: "local-fixture", GOOGLE_CLIENT_SECRET: "local-fixture",
  FIREBASE_PRIVATE_KEY: "", FIREBASE_CLIENT_EMAIL: "", EXCHANGE_RATE_API_KEY: "",
  NEXT_PUBLIC_SENTRY_DSN: "", SENTRY_DSN: "", SENTRY_AUTH_TOKEN: "",
  VERCEL: "", VERCEL_PROJECT_PRODUCTION_URL: "", NEXT_TELEMETRY_DISABLED: "1",
};
async function command(args) {
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { log += chunk; });
  const code = await new Promise(done => child.once("close", done));
  assert.equal(code, 0, log.replaceAll(testUrl, "[test database]"));
}
async function client(email) {
  const context = await request.newContext({ baseURL, timeout: 120_000 });
  contexts.push(context);
  if (email) {
    const { csrfToken } = await (await context.get("/api/auth/csrf")).json();
    const response = await context.post("/api/auth/callback/credentials", { form: { csrfToken, email, password: "runtime-pass-123", json: "true" } });
    assert.ok(response.ok(), await response.text());
    const session = await (await context.get("/api/auth/session")).json();
    assert.ok(session.user?.id);
  }
  return context;
}
async function json(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
try {
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  if (process.env.GROUP_TEST_BASELINE_SCHEMA) {
    const baseline = join(temporary, "schema.prisma");
    await writeFile(baseline, (await readFile(process.env.GROUP_TEST_BASELINE_SCHEMA, "utf8")).replace(/^\uFEFF/, ""));
    await command(["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--schema", baseline]);
    await db.$executeRawUnsafe(`INSERT INTO "${schemaName}"."User" (id,email,name,"accountType") VALUES ('legacy-member','legacy@groups-runtime.invalid','Existing member','WORK')`);
    await command(["node_modules/prisma/build/index.js", "db", "execute", "--schema", baseline, "--file", "prisma/migrations/20260918010000_affiliate_groups/migration.sql"]);
    const legacy = await db.user.findUniqueOrThrow({ where: { id: "legacy-member" }, select: { accountType: true, name: true } });
    assert.equal(await db.affiliateGroupMembership.count(), 0);
    assert.equal(legacy.accountType, "WORK");
    assert.equal(legacy.name, "Existing member");
    console.log("PASS additive group migration preserves existing affiliates");
  } else {
    await command(["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"]);
  }
  if (process.env.GROUP_TEST_BASELINE_SCHEMA) {
    const privateTables = await db.$queryRawUnsafe(`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${schemaName}' AND c.relname IN ('AffiliateGroup','AffiliateGroupMembership')`);
    assert.equal(privateTables.length, 2);
    assert.ok(privateTables.every(table => table.relrowsecurity));
    const grants = await db.$queryRawUnsafe(`SELECT r.rolname, c.relname, has_table_privilege(r.rolname,c.oid,'SELECT') AS readable FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${schemaName}' AND c.relname IN ('AffiliateGroup','AffiliateGroupMembership') AND r.rolname IN ('anon','authenticated')`);
    assert.ok(grants.every(grant => !grant.readable));
    console.log("PASS both private group tables deny public API-role access");
  }
  const passwordHash = await bcrypt.hash("runtime-pass-123", 10);
  await db.user.createMany({ data: [
    { id: "admin", email: env.ADMIN_EMAIL, name: "Group Admin", passwordHash, rewardfulAffiliateId: "fixture-admin", backfillStatus: "COMPLETED" },
    { id: "alpha", email: "alpha@groups-runtime.invalid", name: "Affiliate Alpha", passwordHash, accountType: "WORK", rewardfulAffiliateId: "fixture-alpha", backfillStatus: "COMPLETED" },
    { id: "beta", email: "beta@groups-runtime.invalid", name: "Affiliate Beta", passwordHash, rewardfulAffiliateId: "fixture-beta", backfillStatus: "COMPLETED" },
    ...Array.from({ length: 55 }, (_, i) => ({ id: `extra-${i}`, email: `extra-${i}@groups-runtime.invalid`, name: `Extra ${String(i).padStart(2, "0")}`, rewardfulAffiliateId: `fixture-extra-${i}`, backfillStatus: "COMPLETED" })),
  ] });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout.on("data", chunk => { output = (output + chunk).slice(-100000); });
  app.stderr.on("data", chunk => { output = (output + chunk).slice(-100000); });
  const anonymous = await client();
  let ready = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal(app.exitCode, null, output);
    try { if ((await anonymous.get("/api/auth/csrf", { timeout: 120_000 })).ok()) { ready = true; break; } } catch { /* cold compilation */ }
    await new Promise(done => setTimeout(done, 1000));
  }
  assert.ok(ready, output);
  console.log("Test app ready; checking real sessions and group APIs");
  const admin = await client(env.ADMIN_EMAIL);
  const worker = await client("alpha@groups-runtime.invalid");
  const affiliate = await client("beta@groups-runtime.invalid");
  for (const context of [worker, affiliate]) {
    assert.equal((await context.get("/api/admin/affiliate-groups")).status(), 403);
    assert.equal((await context.post("/api/admin/affiliate-groups", { data: { name: "Forbidden", color: "#112233" } })).status(), 403);
    assert.equal((await context.patch("/api/admin/affiliate-groups/assign", { data: { affiliateIds: ["alpha"], groupId: null } })).status(), 403);
  }
  const created = await json(await admin.post("/api/admin/affiliate-groups", { data: { name: "  Studio   Team  ", color: "#a78bfa" } }), 201);
  const group = created.data ?? created;
  assert.ok(group.id);
  assert.equal((await admin.post("/api/admin/affiliate-groups", { data: { name: "studio team", color: "#123456" } })).status(), 409);
  for (const data of [{ name: "", color: "#123456" }, { name: "Invalid color", color: "red" }]) assert.equal((await admin.post("/api/admin/affiliate-groups", { data })).status(), 400);
  const competing = await Promise.all([1, 2].map(() => admin.post("/api/admin/affiliate-groups", { data: { name: "Concurrent", color: "#123456" } })));
  assert.deepEqual(competing.map(response => response.status()).sort(), [201, 409]);
  await json(await admin.patch("/api/admin/affiliate-groups/assign", { data: { affiliateIds: ["alpha", "beta"], groupId: group.id } }));
  assert.equal(await db.affiliateGroupMembership.count({ where: { groupId: group.id } }), 2);
  assert.equal((await admin.patch("/api/admin/affiliate-groups/assign", { data: { affiliateIds: ["alpha", "missing"], groupId: null } })).status(), 404);
  assert.equal((await db.affiliateGroupMembership.findUniqueOrThrow({ where: { userId: "alpha" } })).groupId, group.id);
  assert.equal((await admin.patch("/api/admin/affiliate-groups/assign", { data: { affiliateIds: ["alpha"], groupId: "missing" } })).status(), 404);
  const filtered = await json(await admin.get(`/api/admin/affiliates?groupId=${group.id}&accountType=WORK&grouped=true`));
  assert.deepEqual(filtered.data.map(user => user.id), ["alpha"]);
  assert.equal(filtered.data[0].affiliateGroup.name, "Studio Team");
  const pages = await Promise.all([1, 2].map(async page => json(await admin.get(`/api/admin/affiliates?grouped=true&page=${page}&limit=50`))));
  const pageIds = pages.flatMap(page => page.data.map(user => user.id));
  assert.equal(new Set(pageIds).size, pageIds.length);
  assert.equal(pageIds.length, await db.user.count());
  assert.deepEqual(pages[0].data.slice(0, 2).map(user => user.id).sort(), ["alpha", "beta"]);
  for (const context of [worker, affiliate]) {
    const profile = await json(await context.get("/api/settings/profile"));
    assert.equal(profile.affiliateGroupId, undefined);
    assert.equal(profile.affiliateGroup, undefined);
  }
  const originalCount = await db.user.count();
  await json(await admin.delete(`/api/admin/affiliate-groups/${group.id}`));
  assert.equal(await db.affiliateGroupMembership.findUnique({ where: { userId: "alpha" } }), null);
  assert.equal(await db.user.count(), originalCount);
  console.log("PASS admin authorization, validation, concurrent names, atomic assignment, filters, pagination, private metadata, and safe deletion");

  // Browser checks below exercise the real UI and API against the same isolated schema.
  browser = await chromium.launch({ headless: true });
  const browserContext = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 1440, height: 1100 } });
  const page = await browserContext.newPage();
  await page.goto(`${baseURL}/admin`, { timeout: 120000 });
  await page.getByRole("heading", { name: "Admin Panel" }).waitFor();
  await page.getByRole("button", { name: "New group", exact: true }).waitFor();
  await page.getByPlaceholder("Search by name or email...").fill("Affiliate ");
  await page.getByRole("button", { name: "New group", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Studio Team");
  await page.getByLabel("Custom color (hex)", { exact: true }).fill("#A78BFA");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Studio Team\s*0$/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Group for Affiliate Alpha", exact: true }).click();
  await page.getByRole("option", { name: "Studio Team", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Group for Affiliate Alpha", exact: true })).toContainText("Studio Team");
  await page.getByRole("checkbox", { name: "Select Affiliate Beta", exact: true }).check();
  await page.getByRole("combobox", { name: "Move to group", exact: true }).click();
  await page.getByRole("option", { name: "Studio Team", exact: true }).click();
  await page.getByRole("button", { name: "Move selected", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Studio Team\s*2$/ })).toBeVisible();
  await page.getByRole("button", { name: "New group", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Priority");
  await page.getByRole("button", { name: "Blue color", exact: true }).click();
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Priority\s*0$/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Group for Affiliate Beta", exact: true }).click();
  await page.getByRole("option", { name: "Priority", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Studio Team\s*1$/ })).toBeVisible();
  await page.getByRole("button", { name: /^Studio Team\s*1$/ }).click();
  await expect(page.getByRole("checkbox", { name: "Select Affiliate Beta", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Studio Team group", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Live Team");
  await page.getByLabel("Custom color (hex)", { exact: true }).fill("#16A085");
  await page.getByRole("button", { name: "Save group", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Live Team\s*1$/ })).toBeVisible();
  const liveTeam = await db.affiliateGroup.findFirstOrThrow({ where: { name: "Live Team" } });
  assert.equal(liveTeam.color, "#16A085");
  await page.reload();
  await page.getByPlaceholder("Search by name or email...").fill("Affiliate ");
  await expect(page.getByRole("combobox", { name: "Group for Affiliate Alpha", exact: true })).toContainText("Live Team");
  await expect(page.getByRole("combobox", { name: "Group for Affiliate Beta", exact: true })).toContainText("Priority");
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole("button", { name: "New group", exact: true }) });
  await card.screenshot({ path: join(artifacts, "desktop.png") });
  await page.setViewportSize({ width: 375, height: 850 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile document must not overflow horizontally");
  await card.screenshot({ path: join(artifacts, "mobile.png") });
  await page.getByRole("button", { name: /^Live Team\s*1$/ }).click();
  await page.getByRole("button", { name: "Edit Live Team group", exact: true }).click();
  await page.getByRole("button", { name: "Delete group", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Live Team?", exact: true }).getByRole("button", { name: "Delete group", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Live Team\s*1$/ })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Group for Affiliate Alpha", exact: true })).toContainText("Ungrouped");
  assert.equal(await db.user.count(), originalCount);
  console.log("PASS real admin browser group creation, single/bulk assignment, rename/color, filtering, persistence, responsive layout, and delete-to-Ungrouped");
} catch (error) {
  await writeFile(join(artifacts, "errors.log"), output);
  throw error;
} finally {
  await browser?.close();
  for (const context of contexts) await context.dispose();
  if (app && app.exitCode === null) {
    if (process.platform === "win32") {
      const stop = spawn("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await new Promise(done => stop.once("exit", done));
    } else app.kill();
    await Promise.race([new Promise(done => app.once("exit", done)), new Promise(done => setTimeout(done, 3000))]);
  }
  provider.closeAllConnections();
  await new Promise(done => provider.close(done));
  assert.match(schemaName, /^groups_verify_[a-f0-9]{32}$/);
  await db.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
  await db.$disconnect();
  assert.equal(dirname(resolve(temporary)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.ok(basename(temporary).startsWith("tu-groups-runtime-"));
  await rm(temporary, { recursive: true, force: true });
}
