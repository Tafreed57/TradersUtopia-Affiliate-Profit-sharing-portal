import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AuthOptions } from "next-auth";
import { loadAppModule } from "./load-app-module.mts";
import * as onboarding from "../src/lib/onboarding-intent.ts";

type UserData = { id?: string; email?: string; accountType?: string; status?: string; [key: string]: unknown };

function loadOptions(initial: UserData | null) {
  let current = initial;
  const writes: UserData[] = [];
  const loaded = loadAppModule<{ authOptions: AuthOptions; authOptionsForSignup(type: "WORK" | "COMMISSION"): AuthOptions }>("src/lib/auth-options.ts", {
    "@auth/prisma-adapter": { PrismaAdapter: () => ({ getUserByEmail: async () => current }) },
    "@/lib/prisma": { prisma: { user: {
      findUnique: async () => current,
      create: async ({ data }: { data: UserData }) => { writes.push(data); return { id: "inserted", ...data }; },
    } } },
    "@/lib/auth-rewardful-link": { linkRewardfulAffiliateWithTimeout: async () => {} },
    "@/lib/constants": { isAdminEmail: (email: string) => email === "admin@example.test" },
  });
  return { ...loaded, writes, setCurrent: (value: UserData | null) => { current = value; } };
}

test("Google adapter assigns Work only on insertion and preserves existing-user adapter lookup", async () => {
  const existing = { id: "existing", email: "old@example.test", accountType: "COMMISSION", status: "ACTIVE" };
  const { authOptionsForSignup, writes } = loadOptions(existing);
  const adapter = authOptionsForSignup("WORK").adapter!;
  const user = await adapter.createUser!({ email: "NEW@EXAMPLE.TEST", name: "New", emailVerified: null } as never);
  assert.equal(user.id, "inserted");
  assert.equal(writes[0].accountType, "WORK");
  assert.equal(writes[0].email, "new@example.test");
  assert.equal(writes[0].canBeTeacher, false);
  assert.equal(writes[0].canProposeRates, false);
  const linked = await adapter.getUserByEmail!("old@example.test");
  assert.equal(linked?.id, "existing");
  assert.equal((linked as unknown as UserData).accountType, "COMMISSION");
  assert.equal(writes.length, 1);
});

test("JWT refresh uses persisted Work permissions even when the previous token claims commissions", async () => {
  const { authOptions } = loadOptions({ id: "existing", status: "ACTIVE", accountType: "WORK" });
  const token = await authOptions.callbacks!.jwt!({ token: { id: "existing", sub: "existing", email: "work@example.test", accountType: "COMMISSION", isAdmin: true }, trigger: "update", session: { accountType: "COMMISSION" } } as never);
  assert.equal(token.accountType, "WORK");
  assert.equal(token.isAdmin, false);
});

test("JWT refresh fills the account type on an existing pre-feature session", async () => {
  const { authOptions } = loadOptions({ id: "existing", status: "ACTIVE", accountType: "COMMISSION" });
  const token = await authOptions.callbacks!.jwt!({ token: { id: "existing", email: "old@example.test" } } as never);
  assert.equal(token.accountType, "COMMISSION");
  assert.equal(token.id, "existing");
});

test("subject-only legacy JWT is upgraded to a complete persisted identity", async () => {
  const { authOptions } = loadOptions({ id: "existing", status: "ACTIVE", accountType: "WORK" });
  const token = await authOptions.callbacks!.jwt!({ token: { sub: "existing", email: "old@example.test" } } as never);
  assert.equal(token.id, "existing");
  assert.equal(token.accountType, "WORK");
});

test("deactivated and deleted accounts lose authenticated identity and admin access", async () => {
  const fixture = loadOptions({ id: "existing", status: "DEACTIVATED", accountType: "WORK" });
  for (const current of [{ id: "existing", status: "DEACTIVATED", accountType: "WORK" }, null]) {
    fixture.setCurrent(current);
    const token = await fixture.authOptions.callbacks!.jwt!({ token: { id: "existing", email: "admin@example.test", isAdmin: true } } as never);
    assert.equal(token.id, "");
    assert.equal(token.isAdmin, false);
  }
});

type AuthRequest = Request & { nextUrl: URL; cookies: { get(name: string): { value: string } | undefined } };
type Handler = (req: AuthRequest, context: { params: Promise<{ nextauth: string[] }> }) => Promise<Response>;
const originalSecret = process.env.NEXTAUTH_SECRET;
const originalUrl = process.env.NEXTAUTH_URL;
const originalVercel = process.env.VERCEL;
afterEach(() => {
  for (const [key, value] of [["NEXTAUTH_SECRET", originalSecret], ["NEXTAUTH_URL", originalUrl], ["VERCEL", originalVercel]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

function authRoute(response: () => Response) {
  process.env.NEXTAUTH_SECRET = "auth-flow-isolated-test-secret";
  process.env.NEXTAUTH_URL = "http://portal.test";
  delete process.env.VERCEL;
  const calls: string[] = [];
  const route = loadAppModule<{ GET: Handler; POST: Handler }>("src/app/api/auth/[...nextauth]/route.ts", {
    "next-auth": (options: { type: string }) => async () => { calls.push(options.type); return response(); },
    "next/server": { NextResponse: {
      json: Response.json,
      redirect: (url: URL) => new Response(null, { status: 307, headers: { Location: url.toString() } }),
    } },
    "@/lib/auth-options": { authOptions: { type: "base" }, authOptionsForSignup: (type: string) => ({ type }) },
    "@/lib/onboarding-intent": onboarding,
  });
  return { route, calls };
}

function request(path: string, cookie?: string, body?: URLSearchParams): AuthRequest {
  const req = new Request(`http://portal.test${path}`, { method: body ? "POST" : "GET", body }) as AuthRequest;
  req.nextUrl = new URL(req.url);
  req.cookies = { get: () => cookie ? { value: cookie } : undefined };
  return req;
}
const callbackContext = { params: Promise.resolve({ nextauth: ["callback", "google"] }) };

test("Google start binds the chosen Work cohort to actual generated OAuth state", async () => {
  const { route, calls } = authRoute(() => Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=generated-state" }));
  const response = await route.POST(request("/api/auth/signin/google", undefined, new URLSearchParams({ onboardingType: "WORK" })), { params: Promise.resolve({ nextauth: ["signin", "google"] }) });
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0].split("=")[1];
  const intent = onboarding.decodeOnboardingIntent(cookie, process.env.NEXTAUTH_SECRET!);
  assert.equal(intent?.accountType, "WORK");
  assert.equal(intent?.state, "generated-state");
  assert.deepEqual(calls, ["base"]);
});

test("valid Work OAuth callback uses insertion classifier and clears completed intent", async () => {
  const { route, calls } = authRoute(() => new Response(null, { status: 302, headers: { Location: "/auth/complete" } }));
  const cookie = onboarding.encodeOnboardingIntent("WORK", "matching-state", process.env.NEXTAUTH_SECRET!);
  const response = await route.GET(request("/api/auth/callback/google?state=matching-state&code=code", cookie), callbackContext);
  assert.deepEqual(calls, ["WORK"]);
  assert.match(response.headers.get("Set-Cookie")!, /Max-Age=0/);
});

test("missing, malformed, expired and mismatched OAuth intent never reach account creation", async () => {
  const { route, calls } = authRoute(() => { throw new Error("Must not invoke NextAuth"); });
  const secret = process.env.NEXTAUTH_SECRET!;
  for (const cookie of [undefined, "malformed", onboarding.encodeOnboardingIntent("WORK", "state", secret, Date.now() - 901_000), onboarding.encodeOnboardingIntent("WORK", "other-state", secret)]) {
    const response = await route.GET(request("/api/auth/callback/google?state=state", cookie), callbackContext);
    assert.equal(response.status, 307);
    assert.match(response.headers.get("Location")!, /OnboardingExpired/);
  }
  assert.equal(calls.length, 0);
});

test("late mismatched callback preserves newer intent cookie", async () => {
  const { route } = authRoute(() => { throw new Error("Must not invoke NextAuth"); });
  const cookie = onboarding.encodeOnboardingIntent("WORK", "new-state", process.env.NEXTAUTH_SECRET!);
  const response = await route.GET(request("/api/auth/callback/google?state=old-state", cookie), callbackContext);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

test("cancelled Work OAuth flow returns to Work with neutral error context", async () => {
  const { route } = authRoute(() => new Response(null, { status: 302, headers: { Location: "/api/auth/error?error=AccessDenied" } }));
  const cookie = onboarding.encodeOnboardingIntent("WORK", "state", process.env.NEXTAUTH_SECRET!);
  const response = await route.GET(request("/api/auth/callback/google?state=state&error=access_denied", cookie), callbackContext);
  assert.equal(response.headers.get("Location"), "http://portal.test/work?error=AccessDenied");
});

function registration(initial: UserData | null = null) {
  let current = initial;
  const writes: UserData[] = [];
  const route = loadAppModule<{ POST(req: Request): Promise<Response> }>("src/app/api/auth/register/route.ts", {
    bcryptjs: { hash: async (password: string) => `hashed:${password}` },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/prisma": { prisma: { user: {
      findUnique: async () => current ? { ...current } : null,
      findUniqueOrThrow: async () => { if (!current) throw new Error("No user"); return { ...current }; },
      create: async ({ data }: { data: UserData }) => { writes.push(data); current = { id: "inserted", ...data }; return current; },
      updateMany: async ({ data, where }: { data: UserData; where: Record<string, unknown> }) => {
        if (!current || current.passwordHash !== null || current.status !== "ACTIVE") return { count: 0 };
        assert.equal(where.passwordHash, null);
        assert.equal(where.status, "ACTIVE");
        assert.deepEqual(JSON.parse(JSON.stringify(where.accounts)), { none: {} });
        writes.push(data);
        current = { ...current, ...data };
        return { count: 1 };
      },
    } } },
  });
  const submit = (accountType: string, password = "test-password") => route.POST(new Request("http://portal.test/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test", email: "PERSON@EXAMPLE.TEST", password, accountType }),
  }));
  return { submit, writes, current: () => current };
}

test("email registration stores Work permissions on a genuinely new user", async () => {
  const fixture = registration();
  const response = await fixture.submit("WORK");
  assert.equal(response.status, 201);
  assert.equal(fixture.current()?.accountType, "WORK");
  assert.equal(fixture.current()?.email, "person@example.test");
  assert.equal(fixture.current()?.canBeTeacher, false);
  assert.equal(fixture.current()?.canProposeRates, false);
});

test("registration rejects forged account types without writes", async () => {
  const fixture = registration();
  assert.equal((await fixture.submit("ADMIN")).status, 400);
  assert.equal(fixture.writes.length, 0);
});

test("claiming a commission placeholder through Work preserves its type", async () => {
  const fixture = registration({ id: "placeholder", email: "person@example.test", accountType: "COMMISSION", status: "ACTIVE", passwordHash: null, rewardfulAffiliateId: "upstream-1", accounts: [] });
  assert.equal((await fixture.submit("WORK")).status, 201);
  assert.equal(fixture.current()?.accountType, "COMMISSION");
  assert.equal(Object.hasOwn(fixture.writes[0], "accountType"), false);
});

test("concurrent placeholder claims cannot overwrite the first installed password", async () => {
  const fixture = registration({ id: "placeholder", email: "person@example.test", accountType: "COMMISSION", status: "ACTIVE", passwordHash: null, rewardfulAffiliateId: "upstream-1", accounts: [] });
  const responses = await Promise.all([fixture.submit("WORK", "first-password"), fixture.submit("WORK", "second-password")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.current()?.passwordHash, "hashed:first-password");
});
