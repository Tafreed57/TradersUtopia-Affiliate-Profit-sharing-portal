// Isolated runtime verification. All writes use a unique disposable Postgres schema,
// and the affiliate provider is a local stub. Never run tests against public tables.
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { request, chromium } from "@playwright/test";

try { process.loadEnvFile(".env"); } catch { /* CI may supply env directly. */ }
const schemaName = `work_verify_${randomUUID().replaceAll("-", "")}`;
assert.match(schemaName, /^work_verify_[a-f0-9]{32}$/);
const databaseUrl = new URL(process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL);
databaseUrl.searchParams.set("schema", schemaName);
const testUrl = databaseUrl.toString();
assert.equal(new URL(testUrl).searchParams.get("schema"), schemaName);
const db = new PrismaClient({ datasourceUrl: testUrl });
const temporary = await mkdtemp(join(tmpdir(), "tu-work-runtime-"));
const contexts = [];
let app;
let browser;
let output = "";
const affiliates = new Map();
const coupons = new Map();
let createCount = 0;
const provider = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = req.headers["content-type"]?.includes("application/json") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw));
  const send = (value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  if (url.pathname === "/affiliates" && req.method === "POST") {
    const affiliate = { ...body, id: randomUUID(), coupons: [] };
    affiliates.set(affiliate.id, affiliate);
    return send(affiliate);
  }
  if (url.pathname === "/affiliates") return send({ data: [...affiliates.values()].filter(a => !url.searchParams.get("email") || a.email === url.searchParams.get("email")) });
  if (url.pathname.startsWith("/affiliates/")) return send(affiliates.get(url.pathname.split("/")[2]) || { id: url.pathname.split("/")[2] });
  if (url.pathname === "/affiliate_coupons" && req.method === "POST") {
    createCount++;
    if (coupons.has(body.token)) return send({ error: "Code already exists" }, 422);
    const coupon = { id: randomUUID(), token: body.token, affiliate_id: body.affiliate_id, archived: false, campaign: { id: "internal-campaign", name: "Internal campaign" } };
    coupons.set(body.token, coupon);
    return send(coupon);
  }
  if (url.pathname === "/affiliate_coupons") return send({ data: [...coupons.values()].filter(c => c.affiliate_id === url.searchParams.get("affiliate_id")) });
  if (url.pathname.startsWith("/campaigns")) return send({ id: "internal-campaign", stripe_coupon_id: "discount-fixture" });
  return send({ data: [] });
});
await new Promise(resolveReady => provider.listen(0, "127.0.0.1", resolveReady));
const providerPort = provider.address().port;
const port = Number(process.env.WORK_TEST_PORT || 3217);
const baseURL = `http://localhost:${port}`;
const env = {
  ...process.env, DATABASE_URL: testUrl, DIRECT_DATABASE_URL: testUrl,
  NEXTAUTH_URL: baseURL, NEXTAUTH_SECRET: "work-runtime-secret-for-isolated-tests-only",
  ADMIN_EMAIL: "admin@work-runtime.invalid", REWARDFUL_API_KEY: "local-fixture",
  REWARDFUL_API_BASE_URL: `http://127.0.0.1:${providerPort}`,
  REWARDFUL_WEBHOOK_SECRET: "local-webhook-secret", DEFAULT_REWARDFUL_CAMPAIGN_ID: "internal-campaign",
  GOOGLE_CLIENT_ID: "work-runtime-client", GOOGLE_CLIENT_SECRET: "local-fixture",
  FIREBASE_PRIVATE_KEY: "", FIREBASE_CLIENT_EMAIL: "", EXCHANGE_RATE_API_KEY: "",
  VERCEL: "", VERCEL_PROJECT_PRODUCTION_URL: "", NEXT_TELEMETRY_DISABLED: "1",
};
async function command(args, extra = {}) {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...extra });
  let log = "";
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { log += chunk; });
  const code = await new Promise(resolveExit => child.on("close", resolveExit));
  if (code !== 0) throw new Error(`Verification command failed (${code}): ${log.replaceAll(testUrl, "[test database]")}`);
}
async function client() {
  const context = await request.newContext({ baseURL, timeout: 120_000 });
  contexts.push(context);
  return context;
}
async function register(context, email, accountType) {
  const response = await context.post("/api/auth/register", { data: { name: "Runtime Tester", email, password: "runtime-pass-123", ...(accountType ? { accountType } : {}) } });
  assert.equal(response.status(), 201, await response.text());
  return response.json();
}
async function login(context, email) {
  const csrf = await (await context.get("/api/auth/csrf")).json();
  const response = await context.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email, password: "runtime-pass-123", callbackUrl: "/auth/complete", json: "true" } });
  assert.equal(response.status(), 200, await response.text());
  const session = await (await context.get("/api/auth/session")).json();
  assert.ok(session.user?.id, JSON.stringify(session));
  return session;
}
try {
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  const baseline = process.env.WORK_TEST_BASELINE_SCHEMA;
  if (baseline) {
    const schemaFile = join(temporary, "schema.prisma");
    await writeFile(schemaFile, await readFile(baseline));
    await command(["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--schema", schemaFile]);
    await db.$executeRawUnsafe(`INSERT INTO "${schemaName}"."User" (id,email,name) VALUES ('existing-before-work','legacy@work-runtime.invalid','Legacy account')`);
    for (const migration of ["20260917120000_work_accounts", "20260917121000_work_promo_creation"]) {
      await command(["node_modules/prisma/build/index.js", "db", "execute", "--schema", schemaFile, "--file", `prisma/migrations/${migration}/migration.sql`]);
    }
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: "existing-before-work" } })).accountType, "COMMISSION");
    console.log("PASS additive migrations preserve existing account type");
  } else {
    await command(["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"]);
  }
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout.on("data", chunk => { output = (output + chunk).slice(-100000); });
  app.stderr.on("data", chunk => { output = (output + chunk).slice(-100000); });
  const anonymous = await client();
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (app.exitCode !== null) throw new Error(`Test app exited: ${output}`);
    try { if ((await anonymous.get("/api/auth/csrf", { timeout: 3000 })).ok()) { ready = true; break; } } catch { /* compilation */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
  }
  assert.ok(ready, output);
  const worker = await client();
  const workerTwo = await client();
  const commission = await client();
  const admin = await client();
  const workUser = await register(worker, "worker@work-runtime.invalid", "WORK");
  const workTwo = await register(workerTwo, "worker-two@work-runtime.invalid", "WORK");
  const regular = await register(commission, "commission@work-runtime.invalid");
  await register(admin, "admin@work-runtime.invalid");
  assert.equal((await login(worker, workUser.email)).user.accountType, "WORK");
  assert.equal((await login(workerTwo, workTwo.email)).user.accountType, "WORK");
  assert.equal((await login(commission, regular.email)).user.accountType, "COMMISSION");
  await login(admin, "admin@work-runtime.invalid");
  assert.equal((await worker.get("/auth/complete", { maxRedirects: 0 })).headers().location, `${baseURL}/attendance`);
  assert.equal((await commission.get("/auth/complete", { maxRedirects: 0 })).headers().location, `${baseURL}/`);
  console.log("PASS credential signup, persisted types, and account-aware landing");

  for (const path of ["/api/commissions", "/api/students", "/api/dashboard/stats", "/api/me/backfill-status", "/api/company/performance", "/api/users/search", "/api/currency"]) {
    assert.equal((await worker.get(path)).status(), 403, path);
  }
  assert.equal(new URL((await worker.get("/commissions", { maxRedirects: 0 })).headers().location, baseURL).pathname, "/attendance");
  assert.equal((await worker.patch("/api/settings/profile", { data: { accountType: "COMMISSION" } })).status(), 403);
  const profile = await (await worker.get("/api/settings/profile")).json();
  assert.equal(profile.canProposeRates, undefined);
  assert.equal(profile.preferredCurrency, undefined);
  console.log("PASS direct page/API restrictions and safe profile");

  for (let i = 0; i < 2; i++) assert.equal((await worker.post("/api/attendance", { data: { date: "2026-09-17", timezone: "America/Toronto", note: `Live session ${i}` } })).status(), 201);
  assert.equal(await db.attendance.count({ where: { userId: workUser.id } }), 2);
  assert.equal(await db.attendance.count({ where: { userId: workTwo.id } }), 0);
  const promoResponses = await Promise.all([worker.post("/api/promo-codes", { data: { proposedCode: "WORKER" } }), worker.post("/api/promo-codes", { data: { proposedCode: "worker" } })]);
  for (const response of promoResponses) assert.ok(response.ok(), await response.text());
  const retry = await worker.post("/api/promo-codes", { data: { proposedCode: "WORKER" } });
  assert.equal((await retry.json()).status, "CREATED");
  assert.equal(createCount, 1);
  assert.equal(await db.promoCodeRequest.count({ where: { proposedCode: "WORKER" } }), 1);
  assert.equal((await workerTwo.post("/api/promo-codes", { data: { proposedCode: "WORKER" } })).status(), 409);
  assert.equal((await (await commission.post("/api/promo-codes", { data: { proposedCode: "NORMAL" } })).json()).status, "PENDING_TEACHER");
  const codes = await (await worker.get("/api/promo-codes")).json();
  assert.equal(codes.activeCoupons.length, 1);
  assert.doesNotMatch(JSON.stringify(codes), /rewardful|campaignName|Internal campaign/);
  console.log("PASS attendance isolation and real database concurrent promo reservation");

  browser = await chromium.launch({ headless: true });
  const workBrowser = await browser.newContext({ storageState: await worker.storageState(), viewport: { width: 1280, height: 850 } });
  const page = await workBrowser.newPage();
  const restrictedRequests = [];
  page.on("request", requestMade => {
    if (/\/api\/(currency|students|dashboard|commissions|me\/backfill-status)/.test(requestMade.url())) restrictedRequests.push(requestMade.url());
  });
  await page.goto(`${baseURL}/attendance`, { timeout: 120_000 });
  await page.locator("aside nav a").first().waitFor();
  assert.deepEqual((await page.locator("aside nav a").allTextContents()).map(text => text.trim()), ["Attendance", "Promo Codes"]);
  assert.equal(await page.title(), "Traders Utopia Affiliate Work");
  await page.goto(`${baseURL}/promo-codes`, { timeout: 120_000 });
  await page.getByRole("heading", { name: "Promo Codes", exact: true }).waitFor();
  assert.doesNotMatch(await page.locator("main").innerText(), /teacher|commission|rewardful/i);
  assert.deepEqual(restrictedRequests, []);
  await page.screenshot({ path: resolve(".next/work-signed-in.png"), fullPage: true, caret: "initial" });
  await workBrowser.close();
  await browser.close();
  browser = null;
  console.log("PASS real signed-in Work navigation, metadata, and query isolation");

  await db.user.update({ where: { id: workUser.id }, data: { initialCommissionPercent: 50, recurringCommissionPercent: 50, ratesConfiguredAt: new Date() } });
  const affiliate = await db.user.findUniqueOrThrow({ where: { id: workUser.id } });
  const payload = JSON.stringify({ event: "commission.created", data: { id: "work-webhook-one", amount: 10000, currency: "USD", created_at: new Date().toISOString(), affiliate: { id: affiliate.rewardfulAffiliateId, email: affiliate.email }, sale: { id: "work-sale-one", amount: 20000, currency: "USD", created_at: new Date().toISOString() } } });
  const conversion = await anonymous.post("/api/webhooks/rewardful", { data: payload, headers: { "Content-Type": "application/json", "x-rewardful-signature": createHmac("sha256", env.REWARDFUL_WEBHOOK_SECRET).update(payload).digest("hex") } });
  assert.ok(conversion.ok(), await conversion.text());
  const event = await db.commissionEvent.findFirstOrThrow({ where: { affiliateId: workUser.id } });
  assert.equal(event.ceoCut.toString(), event.fullAmount.toString());
  assert.equal(await db.commissionSplit.count({ where: { eventId: event.id } }), 0);
  assert.equal(await db.notification.count({ where: { userId: workUser.id, type: "CONVERSION_RECEIVED" } }), 0);
  console.log("PASS signed webhook retains business pool and creates no Work commission");

  const csrf = await (await anonymous.get("/api/auth/csrf")).json();
  const oauth = await anonymous.post("/api/auth/signin/google", { form: { csrfToken: csrf.csrfToken, onboardingType: "WORK", callbackUrl: "/auth/complete", json: "true" } });
  const authorization = new URL((await oauth.json()).url);
  assert.ok(authorization.searchParams.get("state"));
  const storage = await anonymous.storageState();
  const intent = storage.cookies.find(cookie => cookie.name === "tu-onboarding");
  assert.ok(intent?.httpOnly);
  const mismatched = await anonymous.get("/api/auth/callback/google?state=wrong&error=access_denied", { maxRedirects: 0 });
  assert.match(mismatched.headers().location, /\/work\?error=OnboardingExpired$/);
  assert.ok((await anonymous.storageState()).cookies.find(cookie => cookie.name === "tu-onboarding"));
  const cancelled = await anonymous.get(`/api/auth/callback/google?state=${encodeURIComponent(authorization.searchParams.get("state"))}&error=access_denied`, { maxRedirects: 0 });
  assert.match(cancelled.headers().location, /\/work\?error=/);
  assert.equal((await anonymous.storageState()).cookies.find(cookie => cookie.name === "tu-onboarding"), undefined);
  console.log("PASS Google start state binding, mismatched callback, and cancellation recovery");
  console.log("All Work runtime checks passed.");
} catch (error) {
  await writeFile(resolve(".next/work-runtime-errors.log"), output);
  throw error;
} finally {
  if (browser) await browser.close();
  for (const context of contexts) await context.dispose();
  if (app && app.exitCode === null) {
    if (process.platform === "win32") {
      const stop = spawn("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await new Promise(resolveExit => stop.once("exit", resolveExit));
    } else app.kill();
    await Promise.race([new Promise(resolveExit => app.once("exit", resolveExit)), new Promise(resolveDelay => setTimeout(resolveDelay, 3000))]);
  }
  provider.closeAllConnections();
  await new Promise(resolveClose => provider.close(resolveClose));
  // The schema is generated locally, strictly validated, and never public.
  assert.match(schemaName, /^work_verify_[a-f0-9]{32}$/);
  await db.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
  await db.$disconnect();
  assert.equal(dirname(resolve(temporary)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.ok(basename(temporary).startsWith("tu-work-runtime-"));
  await rm(temporary, { recursive: true, force: true });
}
