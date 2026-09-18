import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModule } from "./load-app-module.mts";

type Collection = typeof import("../src/app/api/admin/affiliate-groups/route.ts");
type Detail = typeof import("../src/app/api/admin/affiliate-groups/[id]/route.ts");
type Assignment = typeof import("../src/app/api/admin/affiliate-groups/assign/route.ts");
type Affiliates = typeof import("../src/app/api/admin/affiliates/route.ts");
type Group = { id: string; name: string; nameKey: string; color: string };
type Member = { id: string; accountType: string };
type Membership = { userId: string; groupId: string };
type RawQuery = { sql: string; values: unknown[] };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) => ({ json: async () => body }) as Parameters<Collection["POST"]>[0];
const listRequest = (query: string) => ({ nextUrl: new URL(`https://example.test/api/admin/affiliates?${query}`) }) as Parameters<Affiliates["GET"]>[0];

function modules(prisma: unknown, session: unknown = { user: { id: "admin", isAdmin: true } }) {
  const mocks = {
    "@/lib/prisma": { prisma }, "@/lib/auth-options": { authOptions: {} },
    "next-auth": { getServerSession: async () => session },
  };
  return {
    collection: loadAppModule<Collection>("src/app/api/admin/affiliate-groups/route.ts", mocks),
    detail: loadAppModule<Detail>("src/app/api/admin/affiliate-groups/[id]/route.ts", mocks),
    assignment: loadAppModule<Assignment>("src/app/api/admin/affiliate-groups/assign/route.ts", mocks),
    affiliates: loadAppModule<Affiliates>("src/app/api/admin/affiliates/route.ts", mocks),
  };
}

function fixture() {
  const state = {
    groups: [
      { id: "alpha", name: "Alpha", nameKey: "alpha", color: "#112233" },
      { id: "beta", name: "Beta", nameKey: "beta", color: "#445566" },
    ] as Group[],
    users: [
      { id: "one", accountType: "COMMISSION" },
      { id: "two", accountType: "WORK" },
      { id: "three", accountType: "COMMISSION" },
    ] as Member[],
    memberships: [{ userId: "one", groupId: "alpha" }, { userId: "two", groupId: "beta" }] as Membership[],
    writes: 0, transactions: 0, transactionActive: false,
    shortUpdate: false, foreignKeyFailure: false,
    databaseError: null as { code: string; meta?: { code: string } } | null,
    lockedIds: [] as string[], upsertedIds: [] as string[],
  };
  const projectedGroup = (group: Group) => ({ id: group.id, name: group.name, color: group.color });
  const countMembers = (groupId: string) => state.memberships.filter((membership) => membership.groupId === groupId).length;
  const memberGroups = () => state.users.map((user) => state.memberships.find((membership) => membership.userId === user.id)?.groupId ?? null);
  const db = {
    affiliateGroup: {
      findMany: async () => state.groups.map((group) => ({ ...projectedGroup(group), _count: { memberships: countMembers(group.id) } })),
      findUnique: async ({ where }: { where: { id: string } }) => state.groups.find((group) => group.id === where.id) ?? null,
      create: async ({ data }: { data: Omit<Group, "id"> }) => {
        if (state.groups.some((group) => group.nameKey === data.nameKey)) throw { code: "P2002" };
        const group = { ...data, id: "new-group" };
        state.groups.push(group); state.writes++;
        return projectedGroup(group);
      },
      update: async ({ where, data }: { where: { id: string }; data: Omit<Group, "id"> }) => {
        const group = state.groups.find((item) => item.id === where.id);
        if (!group) throw { code: "P2025" };
        if (state.groups.some((item) => item.id !== where.id && item.nameKey === data.nameKey)) throw { code: "P2002" };
        Object.assign(group, data); state.writes++;
        return { ...projectedGroup(group), _count: { memberships: countMembers(group.id) } };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        if (!state.groups.some((group) => group.id === where.id)) throw { code: "P2025" };
        state.groups = state.groups.filter((group) => group.id !== where.id);
        // Emulate ON DELETE CASCADE on private mappings, never on User.
        state.memberships = state.memberships.filter((membership) => membership.groupId !== where.id);
        state.writes++;
      },
    },
    user: {
      count: async ({ where }: { where: unknown }) => {
        assert.deepEqual(clone(where), { affiliateGroupMembership: { is: null } });
        return memberGroups().filter((group) => group === null).length;
      },
    },
    affiliateGroupMembership: {
      deleteMany: async ({ where }: { where: { userId: { in: string[] } } }) => {
        assert.equal(state.transactionActive, true, "membership writes must occur inside a transaction");
        state.memberships = state.memberships.filter((membership) => !where.userId.in.includes(membership.userId));
        state.writes++;
      },
    },
    $queryRaw: async (query: RawQuery) => {
      assert.equal(state.transactionActive, true, "row locks must remain inside the assignment transaction");
      assert.match(query.sql, /SELECT "id" FROM "User"/);
      assert.match(query.sql, /ORDER BY "id" FOR KEY SHARE/);
      state.lockedIds = clone(query.values) as string[];
      return state.users.filter((user) => state.lockedIds.includes(user.id)).map(({ id }) => ({ id }));
    },
    $executeRaw: async (query: RawQuery) => {
      assert.equal(state.transactionActive, true, "membership writes must occur inside a transaction");
      assert.match(query.sql, /INSERT INTO "AffiliateGroupMembership"/);
      assert.match(query.sql, /ON CONFLICT \("userId"\) DO UPDATE/);
      const rows: Membership[] = [];
      for (let index = 0; index < query.values.length; index += 2) {
        rows.push({ userId: String(query.values[index]), groupId: String(query.values[index + 1]) });
      }
      state.upsertedIds = rows.map((row) => row.userId);
      const updated = state.shortUpdate ? rows.slice(0, 1) : rows;
      for (const row of updated) {
        const existing = state.memberships.find((membership) => membership.userId === row.userId);
        if (existing) existing.groupId = row.groupId;
        else state.memberships.push(row);
      }
      state.writes++;
      if (state.foreignKeyFailure) throw { code: "P2010", meta: { code: "23503" } };
      if (state.databaseError) throw state.databaseError;
      return updated.length;
    },
  };
  const prisma = { ...db, $transaction: async (callback: (tx: typeof db) => Promise<unknown>) => {
    const before = clone(state.memberships);
    state.transactions++; state.transactionActive = true;
    try { return await callback(db); }
    catch (error) { state.memberships = before; throw error; }
    finally { state.transactionActive = false; }
  } };
  return { state, memberGroups, ...modules(prisma) };
}

for (const session of [null, { user: { id: "regular", isAdmin: false, accountType: "COMMISSION" } }, { user: { id: "work", isAdmin: false, accountType: "WORK" } }]) {
  test(`all admin group handlers deny ${session?.user.id ?? "anonymous"} before database access`, async () => {
    const routes = modules({}, session);
    const body = request({ name: "Group", color: "#112233" });
    const responses = await Promise.all([
      routes.collection.GET(), routes.collection.POST(body),
      routes.detail.PATCH(body, context("alpha")), routes.detail.DELETE(body, context("alpha")),
      routes.assignment.PATCH(request({ affiliateIds: ["one"], groupId: null })),
      routes.affiliates.GET(listRequest("groupId=alpha")),
    ]);
    responses.forEach((response) => assert.equal(response.status, 403));
  });
}

test("group create/edit normalizes names and colors, rejects equivalent duplicates, and returns member counts", async () => {
  const f = fixture();
  const created = await f.collection.POST(request({ name: "  Team\n  North  ", color: "#ab12ef" }));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { data: { id: "new-group", name: "Team North", color: "#AB12EF", memberCount: 0 } });
  const duplicate = await f.collection.POST(request({ name: "ＴＥＡＭ NORTH", color: "#FFFFFF" }));
  assert.equal(duplicate.status, 409);
  const edited = await f.detail.PATCH(request({ name: "  Primary Team ", color: "#abcdef" }), context("alpha"));
  assert.deepEqual(await edited.json(), { data: { id: "alpha", name: "Primary Team", color: "#ABCDEF", memberCount: 1 } });
  assert.equal((await f.detail.PATCH(request({ name: "beta", color: "#123456" }), context("alpha"))).status, 409);
  assert.equal((await f.detail.PATCH(request({ name: "Valid", color: "#123456" }), context("missing"))).status, 404);
  const listed = await (await f.collection.GET()).json();
  assert.equal(listed.ungroupedCount, 1);
  assert.equal(listed.data.find((group: { id: string }) => group.id === "alpha").memberCount, 1);
});

test("create and update reject normalized system labels while ordinary names stay valid", async () => {
  const f = fixture();
  for (const name of [" UnGrOuPeD ", "ALL   AFFILIATES", " aLl ", "ＡＬＬ"]) {
    const body = request({ name, color: "#123456" });
    const responses = [await f.collection.POST(body), await f.detail.PATCH(body, context("alpha"))];
    for (const response of responses) {
      assert.equal(response.status, 400, name);
      assert.match((await response.json()).error, /reserved/i);
    }
  }
  assert.equal(f.state.writes, 0);
  assert.equal((await f.collection.POST(request({ name: "All Stars", color: "#123456" }))).status, 201);
  assert.equal((await f.detail.PATCH(request({ name: "Ungrouped Alumni", color: "#123456" }), context("alpha"))).status, 200);
});

test("malformed group names, colors, extra fields and invalid JSON never reach persistence", async () => {
  const routes = modules({});
  const badBodies = [
    { name: "   ", color: "#123456" }, { name: "x".repeat(49), color: "#123456" },
    { name: "Team\u0000North", color: "#123456" }, { name: "Team\u0080North", color: "#123456" },
    { name: 12, color: "#123456" }, { name: "Team", color: "red" },
    { name: "Team", color: "#fff" }, { name: "Team", color: "#12345678" },
    { name: "Team", color: "#12345Z" }, { name: "Team", color: "#123456;display:none" },
    { name: "Team" }, { name: "Team", color: "#123456", accountType: "WORK" }, null,
  ];
  for (const body of badBodies) {
    assert.equal((await routes.collection.POST(request(body))).status, 400, JSON.stringify(body));
    assert.equal((await routes.detail.PATCH(request(body), context("alpha"))).status, 400, JSON.stringify(body));
  }
  const invalidJson = { json: async () => { throw new SyntaxError("Invalid JSON"); } } as unknown as Parameters<Collection["POST"]>[0];
  assert.equal((await routes.collection.POST(invalidJson)).status, 400);
});

test("bulk assignment supports both cohorts and null clears only selected memberships", async () => {
  const f = fixture();
  const beforeUsers = clone(f.state.users);
  const assigned = await f.assignment.PATCH(request({ affiliateIds: ["two", "one"], groupId: "beta" }));
  assert.deepEqual(await assigned.json(), { success: true, updatedCount: 2 });
  assert.deepEqual(f.memberGroups(), ["beta", "beta", null]);
  assert.deepEqual(f.state.lockedIds, ["one", "two"]);
  assert.deepEqual(f.state.upsertedIds, ["one", "two"]);
  const cleared = await f.assignment.PATCH(request({ affiliateIds: ["two"], groupId: null }));
  assert.deepEqual(await cleared.json(), { success: true, updatedCount: 1 });
  assert.deepEqual(f.memberGroups(), ["beta", null, null]);
  assert.deepEqual(f.state.users, beforeUsers, "private grouping never changes a user record");
});

test("assignment rejects missing, duplicated, oversized and malformed identifiers before writes", async () => {
  const { assignment } = modules({});
  const invalid = [
    { affiliateIds: [], groupId: null }, { affiliateIds: ["one", "one"], groupId: null },
    { affiliateIds: [" one", "one "], groupId: "beta" },
    { affiliateIds: Array.from({ length: 101 }, (_, index) => `user-${index}`), groupId: null },
    { affiliateIds: [""], groupId: null }, { affiliateIds: ["one"], groupId: " " },
    { affiliateIds: ["invalid id"], groupId: null }, { affiliateIds: ["one"], groupId: "alpha/beta" },
    { affiliateIds: ["one\u0000"], groupId: null }, { affiliateIds: ["x".repeat(129)], groupId: null },
    { affiliateIds: ["one"], groupId: 1 }, { affiliateIds: ["one"] },
    { affiliateIds: ["one"], groupId: null, role: "ADMIN" },
  ];
  for (const body of invalid) assert.equal((await assignment.PATCH(request(body))).status, 400, JSON.stringify(body));
});

test("missing group or user rejects the full assignment before any member is changed", async () => {
  const f = fixture();
  const before = clone(f.state.memberships);
  assert.equal((await f.assignment.PATCH(request({ affiliateIds: ["one", "two"], groupId: "missing" }))).status, 404);
  assert.equal((await f.assignment.PATCH(request({ affiliateIds: ["one", "missing"], groupId: "beta" }))).status, 404);
  assert.equal((await f.assignment.PATCH(request({ affiliateIds: ["one", "missing"], groupId: null }))).status, 404);
  assert.equal(f.state.writes, 0);
  assert.deepEqual(f.state.memberships, before);
});

for (const failure of ["shortUpdate", "foreignKeyFailure"] as const) {
  test(`assignment rolls back every membership when ${failure} occurs concurrently`, async () => {
    const f = fixture();
    const before = clone(f.state.memberships);
    f.state[failure] = true;
    const result = await f.assignment.PATCH(request({ affiliateIds: ["one", "three"], groupId: "beta" }));
    assert.equal(result.status, 404);
    assert.equal(f.state.transactions, 1);
    assert.equal(f.state.writes, 1);
    assert.deepEqual(f.state.memberships, before);
  });
}

test("assignment rolls back and returns a retryable conflict for database concurrency failures", async () => {
  for (const error of [{ code: "P2034" }, { code: "P2010", meta: { code: "40P01" } }, { code: "P2010", meta: { code: "40001" } }]) {
    const f = fixture();
    const before = clone(f.state.memberships);
    f.state.databaseError = error;
    const response = await f.assignment.PATCH(request({ affiliateIds: ["three", "one"], groupId: "beta" }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /try again/i);
    assert.deepEqual(f.state.memberships, before);
  }
});

test("group deletion unassigns members and preserves every affiliate", async () => {
  const f = fixture();
  const beforeUsers = clone(f.state.users);
  const result = await f.detail.DELETE(request(null), context("alpha"));
  assert.deepEqual(await result.json(), { success: true });
  assert.equal(f.state.users.length, 3);
  assert.deepEqual(f.state.users, beforeUsers);
  assert.deepEqual(f.memberGroups(), [null, "beta", null]);
  assert.equal((await f.detail.DELETE(request(null), context("missing"))).status, 404);
});

test("group edit/delete reject malformed path IDs before database access", async () => {
  const { detail } = modules({});
  for (const id of ["", " alpha", "alpha/beta", "group\u0000", "x".repeat(129)]) {
    assert.equal((await detail.PATCH(request({ name: "Valid", color: "#123456" }), context(id))).status, 400, id);
    assert.equal((await detail.DELETE(request(null), context(id))).status, 400, id);
  }
});

test("admin list combines cohort/status/search/group filters and sorts before pagination", async () => {
  const calls: Record<string, unknown>[] = [];
  let countedWhere: unknown;
  const { affiliates } = modules({ user: {
    findMany: async (args: Record<string, unknown>) => { calls.push(clone(args)); return []; },
    count: async ({ where }: { where: unknown }) => { countedWhere = clone(where); return 8; },
  } });
  const response = await affiliates.GET(listRequest("groupId=alpha&grouped=true&accountType=WORK&status=ACTIVE&search=Test&page=2&limit=3"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).pagination, { page: 2, limit: 3, total: 8, totalPages: 3 });
  assert.deepEqual(calls[0].where, countedWhere);
  assert.deepEqual(calls[0].where, {
    affiliateGroupMembership: { is: { groupId: "alpha" } }, accountType: "WORK", status: "ACTIVE",
    OR: [{ name: { contains: "Test", mode: "insensitive" } }, { email: { contains: "Test", mode: "insensitive" } }],
  });
  assert.deepEqual(calls[0].orderBy, [{ affiliateGroupMembership: { group: { nameKey: "asc" } } }, { createdAt: "desc" }, { id: "asc" }]);
  assert.equal(calls[0].skip, 3);
  assert.equal(calls[0].take, 3);
  assert.deepEqual((calls[0].select as Record<string, unknown>).affiliateGroupMembership, { select: { group: { select: { id: true, name: true, color: true } } } });
  await affiliates.GET(listRequest("groupId=ungrouped&limit=500"));
  assert.deepEqual(calls[1].where, { affiliateGroupMembership: { is: null } });
  assert.deepEqual(calls[1].orderBy, [{ createdAt: "desc" }, { id: "asc" }]);
  assert.equal(calls[1].take, 100);
});

test("admin list projects private membership storage into the group display DTO", async () => {
  const amount = { toNumber: () => 20 };
  const base = {
    id: "one", name: "First Affiliate", accountType: "WORK",
    commissionPercent: amount, initialCommissionPercent: amount, recurringCommissionPercent: amount,
    _count: { recipientSplits: 0, studentRelations: 0, teacherRelations: 0 },
  };
  const group = { id: "alpha", name: "Alpha", color: "#123456" };
  const { affiliates } = modules({ user: {
    findMany: async () => [
      { ...base, affiliateGroupMembership: { group } },
      { ...base, id: "two", affiliateGroupMembership: null },
    ],
    count: async () => 2,
  } });
  const response = await affiliates.GET(listRequest("grouped=true"));
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data[0].affiliateGroup, group);
  assert.equal(data[1].affiliateGroup, null);
  assert.equal(data[0].commissionsCount, 0);
  assert.doesNotMatch(JSON.stringify(data), /affiliateGroupMembership|nameKey|_count/);
});

test("admin list rejects invalid pagination and group filters before querying", async () => {
  const { affiliates } = modules({});
  for (const query of ["page=NaN", "page=0", "page=-1", "page=1.5", "page=9007199254740991&limit=100", "limit=0", "limit=1.5", "groupId=", "groupId=%20alpha", "groupId=alpha%2Fbeta", "groupId=alpha%00", `groupId=${"x".repeat(129)}`]) {
    assert.equal((await affiliates.GET(listRequest(query))).status, 400, query);
  }
});
