import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModule } from "./load-app-module.mts";
import { WORK_NOTIFICATION_TYPES, isWorkNotificationAllowed, workNotificationPresentation } from "../src/lib/work-notification-policy.ts";

type Notifications = typeof import("../src/lib/notifications.ts");
type NotificationRoute = typeof import("../src/app/api/notifications/route.ts");
type ProfileRoute = typeof import("../src/app/api/settings/profile/route.ts");

test("Work notification allowlist excludes every financial, lead, student and new unknown category", () => {
  for (const type of ["CONVERSION_RECEIVED", "ATTENDANCE_FORFEITURE_ALERT", "COMMISSION_RATE_CHANGED", "NEW_STUDENT_LINKED", "STUDENT_PAYMENT_RECEIVED", "RATE_PROPOSAL_APPROVED", "NEW_TYPE"]) {
    assert.equal(isWorkNotificationAllowed(type), false, type);
  }
  for (const type of WORK_NOTIFICATION_TYPES) {
    assert.equal(isWorkNotificationAllowed(type), true);
    const copy = workNotificationPresentation(type);
    assert.match(copy.data.href, /^\/(attendance|promo-codes|settings|notifications)$/);
    assert.doesNotMatch(JSON.stringify(copy), /rewardful|commission|percent|rate|student/i);
  }
});

test("Work commission notification is suppressed before persistence or device lookup", async () => {
  const { createNotification } = loadAppModule<Notifications>("src/lib/notifications.ts", {
    "@sentry/nextjs": {},
    "@/lib/constants": { isAdminEmail: () => false },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => ({ accountType: "WORK", email: "work@example.com" }) } } },
  });
  const result = await createNotification({ userId: "work", type: "CONVERSION_RECEIVED", title: "Commission", body: "You earned $20" });
  assert.equal(result, null);
});

test("Work promo notice removes unsafe destinations and metadata before persistence and push", async () => {
  const writes: Array<{ title: string; body: string; data: Record<string, unknown> }> = [];
  const { createNotification } = loadAppModule<Notifications>("src/lib/notifications.ts", {
    "@sentry/nextjs": {},
    "@/lib/constants": { isAdminEmail: () => false },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => ({ accountType: "WORK", email: "work@example.com" }) },
      notification: { create: async ({ data }: { data: typeof writes[number] }) => { writes.push(data); return { id: "notice" }; }, update: async () => ({}) },
      deviceToken: { findMany: async () => [] },
    } },
  });
  const result = await createNotification({ userId: "work", type: "PROMO_CODE_APPROVED", title: "Rewardful code", body: "Commission rate 50%", data: { href: "//example.com", commissionRate: 50, campaignName: "Internal" } });
  assert.equal(result?.id, "notice");
  assert.equal(writes[0].data.href, "/promo-codes");
  assert.deepEqual(Object.keys(writes[0].data), ["href"]);
  assert.doesNotMatch(JSON.stringify(writes[0]), /rewardful|commission|percent|50|Internal/i);
});

test("Work notification API filters rows, totals and unread counts using persisted cohort", async () => {
  const rows = [
    { id: "promo", type: "PROMO_CODE_APPROVED", read: false, title: "Rewardful code", body: "Commission rate 50%", data: { href: "/commissions", rate: 50 }, createdAt: new Date(), pushError: "Provider error" },
    { id: "money", type: "CONVERSION_RECEIVED", read: false },
    { id: "attendance", type: "FIRST_ATTENDANCE_RECORDED", read: true, createdAt: new Date() },
  ];
  type Where = { read?: boolean; type?: { in: string[] } };
  const filter = (where: Where) => rows.filter((row) => (!where.type || where.type.in.includes(row.type)) && (where.read === undefined || row.read === where.read));
  const { GET } = loadAppModule<NotificationRoute>("src/app/api/notifications/route.ts", {
    "next-auth": { getServerSession: async () => ({ user: { id: "work", accountType: "COMMISSION" } }) },
    "@/lib/auth-options": { authOptions: {} },
    "@/lib/constants": { isAdminEmail: () => false },
    "@/lib/commission-cad-service": { getCommissionCadAllocations: () => assert.fail("Work must not query currency allocations") },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => ({ accountType: "WORK", email: "work@example.com" }) },
      notification: { findMany: async ({ where }: { where: Where }) => filter(where), count: async ({ where }: { where: Where }) => filter(where).length },
    } },
  });
  const response = await GET({ nextUrl: new URL("https://example.com/api/notifications") } as Parameters<typeof GET>[0]);
  const body = await response.json();
  assert.equal(body.data.length, 2);
  assert.equal(body.pagination.total, 2);
  assert.equal(body.unreadCount, 1);
  assert.equal(body.data[0].data.href, "/promo-codes");
  assert.doesNotMatch(JSON.stringify(body), /rewardful|commission|rate|Provider error/i);
});

test("Work profile API exposes no rate/currency preferences and denies updates even with stale session", async () => {
  const { GET, PATCH } = loadAppModule<ProfileRoute>("src/app/api/settings/profile/route.ts", {
    "next-auth": { getServerSession: async () => ({ user: { id: "work", accountType: "COMMISSION" } }) },
    "@/lib/auth-options": { authOptions: {} },
    "@/lib/constants": { isAdminEmail: () => false },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => ({ id: "work", name: "Work User", email: "work@example.com", accountType: "WORK", canProposeRates: true, preferredCurrency: "CAD", createdAt: new Date() }) } } },
  });
  const profile = await (await GET()).json();
  assert.equal(profile.accountType, "WORK");
  assert.equal(profile.canProposeRates, undefined);
  assert.equal(profile.preferredCurrency, undefined);
  const denied = await PATCH({ json: async () => ({ preferredCurrency: "USD" }) } as Parameters<typeof PATCH>[0]);
  assert.equal(denied.status, 403);
});
