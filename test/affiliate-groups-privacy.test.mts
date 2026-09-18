import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModule } from "./load-app-module.mts";

type Profile = typeof import("../src/app/api/settings/profile/route.ts");
type Search = typeof import("../src/app/api/users/search/route.ts");
type Register = typeof import("../src/app/api/auth/register/route.ts");

const fullUser = {
  id: "affiliate", name: "Example Affiliate", email: "affiliate@example.test", image: null,
  accountType: "COMMISSION", createdAt: new Date(), canProposeRates: false, preferredCurrency: "CAD",
  affiliateGroupId: "private-group", groupId: "private-group",
  affiliateGroup: { id: "private-group", name: "Admin Private Group", color: "#AA1234" },
  affiliateGroupMembership: { groupId: "private-group", group: { id: "private-group", name: "Admin Private Group", color: "#AA1234" } },
};

function projectedUser(select: Record<string, unknown>, accountType = "COMMISSION") {
  assert.equal(select.affiliateGroupId, undefined);
  assert.equal(select.groupId, undefined);
  assert.equal(select.affiliateGroup, undefined);
  assert.equal(select.affiliateGroupMembership, undefined);
  const source: Record<string, unknown> = { ...fullUser, accountType };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key] === true).map((key) => [key, source[key]]));
}

function assertPrivate(response: unknown) {
  assert.doesNotMatch(JSON.stringify(response), /groupId|affiliateGroup|private-group|Admin Private Group|AA1234/i);
}

for (const accountType of ["COMMISSION", "WORK"]) {
  test(`${accountType} profile remains private when a user belongs to an admin group`, async () => {
    const { GET } = loadAppModule<Profile>("src/app/api/settings/profile/route.ts", {
      "next-auth": { getServerSession: async () => ({ user: { id: "affiliate", accountType } }) },
      "@/lib/auth-options": { authOptions: {} },
      "@/lib/constants": { isAdminEmail: () => false },
      "@/lib/prisma": { prisma: { user: { findUnique: async ({ select }: { select: Record<string, unknown> }) => projectedUser(select, accountType) } } },
    });
    const response = await GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.id, "affiliate");
    assertPrivate(body);
  });
}

test("teacher user search does not disclose a student's admin group", async () => {
  const { GET } = loadAppModule<Search>("src/app/api/users/search/route.ts", {
    "next-auth": { getServerSession: async () => ({ user: { id: "teacher" } }) },
    "@/lib/auth-options": { authOptions: {} },
    "@/lib/prisma": { prisma: {
      teacherStudent: { findMany: async () => [] },
      user: { findMany: async ({ select }: { select: Record<string, unknown> }) => [projectedUser(select)] },
    } },
  });
  const response = await GET({ nextUrl: new URL("https://example.test/api/users/search?q=affiliate") } as Parameters<typeof GET>[0]);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 1);
  assertPrivate(body);
});

test("registration projects identity explicitly rather than exposing new user scalars", async () => {
  const { POST } = loadAppModule<Register>("src/app/api/auth/register/route.ts", {
    "bcryptjs": { hash: async () => "test-hash" },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => null, create: async () => fullUser } } },
  });
  const response = await POST({ json: async () => ({ name: "Example Affiliate", email: "affiliate@example.test", password: "test-only-password" }) } as Parameters<typeof POST>[0]);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.id, "affiliate");
  assertPrivate(body);
});
