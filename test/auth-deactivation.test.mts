import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthOptions, Session } from "next-auth";
import { loadAppModule } from "./load-app-module.mts";

type Account = {
  id: string; email: string; status: string; accountType: string;
  passwordHash: string | null; rewardfulAffiliateId: string | null;
};
const active: Account = {
  id: "affiliate", email: "person@example.test", status: "ACTIVE",
  accountType: "COMMISSION", passwordHash: "hashed", rewardfulAffiliateId: "linked",
};

function authentication(initial: Account | null) {
  let current = initial;
  let checks = 0;
  const reads: unknown[] = [];
  const { authOptions } = loadAppModule<{ authOptions: AuthOptions }>("src/lib/auth-options.ts", {
    "@auth/prisma-adapter": { PrismaAdapter: () => ({}) },
    bcryptjs: { compare: async () => { checks += 1; return true; } },
    "@/lib/prisma": { prisma: { user: { findUnique: async (query: unknown) => { reads.push(query); return current; } } } },
    "@/lib/constants": { isAdminEmail: (email: string) => email === "admin@example.test" },
    "@/lib/auth-rewardful-link": { linkRewardfulAffiliateWithTimeout: async () => { throw new Error("Inactive account must not be linked"); } },
  });
  const credentials = authOptions.providers.find((provider) => provider.id === "credentials") as unknown as {
    options: { authorize(data: { email: string; password: string }): Promise<unknown> };
  };
  return {
    options: authOptions,
    login: () => credentials.options.authorize({ email: "PERSON@EXAMPLE.TEST", password: "correct-password" }),
    passwordChecks: () => checks,
    reads,
    setCurrent: (value: Account | null) => { current = value; },
  };
}

test("deactivated accounts cannot sign in with the correct password or Google", async () => {
  const fixture = authentication({ ...active, status: "DEACTIVATED", rewardfulAffiliateId: null });
  assert.equal(await fixture.login(), null);
  assert.equal(fixture.passwordChecks(), 0);
  assert.equal(await fixture.options.callbacks!.signIn!({ user: { id: active.id, email: "PERSON@EXAMPLE.TEST" }, account: { provider: "google" } } as never), false);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.reads)), [
    { where: { email: "person@example.test" } },
    { where: { email: "person@example.test" } },
  ]);
});

test("active accounts still sign in with credentials and Google", async () => {
  const fixture = authentication(active);
  assert.equal((await fixture.login() as { id: string }).id, active.id);
  assert.equal(fixture.passwordChecks(), 1);
  assert.equal(await fixture.options.callbacks!.signIn!({ user: { id: active.id, email: active.email }, account: { provider: "google" } } as never), true);
});

test("an existing session loses its identity on deactivation and stays revoked on later refreshes", async () => {
  const fixture = authentication(active);
  let token = await fixture.options.callbacks!.jwt!({ token: { id: active.id, sub: active.id, email: "admin@example.test" } } as never);
  assert.equal(token.id, active.id);
  fixture.setCurrent({ ...active, status: "DEACTIVATED" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    token = await fixture.options.callbacks!.jwt!({ token } as never);
    assert.equal(token.id, "");
    assert.equal(token.sub, "");
    assert.equal(token.isAdmin, false);
    const session = await fixture.options.callbacks!.session!({ session: { user: { email: active.email } }, token } as never) as Session;
    assert.equal(session.user.id, "");
    assert.equal(session.user.isAdmin, false);
  }
});

test("deleted accounts and database errors cannot keep authenticated server access", async () => {
  const fixture = authentication(null);
  const token = await fixture.options.callbacks!.jwt!({ token: { id: active.id, sub: active.id, email: active.email } } as never);
  assert.equal(token.id, "");
  const { authOptions } = loadAppModule<{ authOptions: AuthOptions }>("src/lib/auth-options.ts", {
    "@auth/prisma-adapter": { PrismaAdapter: () => ({}) },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => { throw new Error("Database unavailable"); } } } },
    "@/lib/constants": { isAdminEmail: () => false },
    "@/lib/auth-rewardful-link": {},
  });
  await assert.rejects(() => Promise.resolve(authOptions.callbacks!.jwt!({ token: { id: active.id, sub: active.id } } as never)), /Database unavailable/);
});

test("a deactivated placeholder cannot regain access by registering the same email", async () => {
  let writes = 0;
  const { POST } = loadAppModule<{ POST(req: Request): Promise<Response> }>("src/app/api/auth/register/route.ts", {
    bcryptjs: { hash: async () => "new-password-hash" },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/prisma": { prisma: { user: {
      findUnique: async () => ({ ...active, status: "DEACTIVATED", passwordHash: null, accounts: [] }),
      updateMany: async ({ where }: { where: { status: string } }) => { assert.equal(where.status, "ACTIVE"); return { count: 0 }; },
      create: async () => { writes += 1; throw new Error("Must not recreate account"); },
    } } },
  });
  const response = await POST(new Request("https://portal.test/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Rejoin", email: active.email, password: "test-password", accountType: "WORK" }),
  }));
  assert.equal(response.status, 409);
  assert.equal(writes, 0);
});

test("protected pages and APIs reject a previously valid JWT immediately after deactivation", async () => {
  let status = "ACTIVE";
  let unavailable = false;
  const { proxy } = loadAppModule<typeof import("../src/proxy.ts")>("src/proxy.ts", {
    "next-auth/jwt": { getToken: async () => ({ id: active.id, sub: active.id, email: active.email }) },
    "next/server": { NextResponse: {
      next: () => new Response(null, { status: 200 }),
      json: Response.json,
      redirect: (url: URL) => new Response(null, { status: 307, headers: { Location: String(url) } }),
    } },
    "@/lib/constants": { isAdminEmail: () => false },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => {
      if (unavailable) throw new Error("Database unavailable");
      return { ...active, status };
    } } } },
  });
  const access = (path: string) => {
    const url = new URL(path, "https://portal.test");
    return proxy({ url: url.toString(), nextUrl: url, method: "GET" } as Parameters<typeof proxy>[0]);
  };
  assert.equal((await access("/api/attendance")).status, 200);
  assert.equal((await access("/commissions")).status, 200);
  status = "DEACTIVATED";
  for (const path of ["/api/attendance", "/api/commissions", "/api/admin/affiliates"]) {
    assert.equal((await access(path)).status, 401, path);
  }
  const page = await access("/commissions");
  assert.equal(page.status, 307);
  assert.equal(page.headers.get("Location"), "https://portal.test/login");
  unavailable = true;
  assert.equal((await access("/api/attendance")).status, 503);
});
