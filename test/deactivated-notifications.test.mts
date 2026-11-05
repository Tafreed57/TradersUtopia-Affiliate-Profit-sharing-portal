import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModule } from "./load-app-module.mts";

type Notifications = typeof import("../src/lib/notifications.ts");
type NotificationInput = Parameters<Notifications["createNotification"]>[0];

function fixture(status: "ACTIVE" | "DEACTIVATED", accountType = "COMMISSION") {
  const state = {
    status,
    writes: [] as unknown[],
    deliveries: [] as unknown[],
    deliveryStatus: "",
    revokeAfterCreate: false,
    tokenReads: 0,
  };
  const service = loadAppModule<Notifications>("src/lib/notifications.ts", {
    "@sentry/nextjs": { captureException: (error: unknown) => { throw error; } },
    "@/lib/constants": { isAdminEmail: () => false },
    "@/lib/firebase-admin": { getMessaging: () => ({ send: async (message: unknown) => { state.deliveries.push(message); } }) },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => ({ accountType, email: "affiliate@example.com", status: state.status }) },
      notification: {
        create: async ({ data }: { data: unknown }) => {
          state.writes.push(data);
          if (state.revokeAfterCreate) state.status = "DEACTIVATED";
          return { id: "notice" };
        },
        update: async ({ data }: { data: { pushStatus: string } }) => { state.deliveryStatus = data.pushStatus; },
      },
      deviceToken: { findMany: async ({ where }: { where: { userId: string; user?: { status: string } } }) => {
        state.tokenReads++;
        assert.equal(where.userId, "affiliate");
        return !where.user || where.user.status === state.status ? [{ id: "device", token: "retained-device-token" }] : [];
      } },
    } },
  });
  return { state, ...service };
}

function notice(type: NotificationInput["type"]): NotificationInput {
  return { userId: "affiliate", type, title: "Account update", body: "An update is available." };
}

for (const accountType of ["COMMISSION", "WORK"]) {
  test(`deactivated ${accountType} account receives no routine notifications on retained devices`, async () => {
    const f = fixture("DEACTIVATED", accountType);
    for (const type of ["CONVERSION_RECEIVED", "STUDENT_PAYMENT_RECEIVED", "PROMO_CODE_APPROVED"] as const) {
      assert.equal(await f.createNotification(notice(type)), null);
    }
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.tokenReads, 0);
    assert.equal(f.state.deliveries.length, 0);
  });

  test(`deactivated ${accountType} account can still receive its final deactivation notice`, async () => {
    const f = fixture("DEACTIVATED", accountType);
    assert.equal((await f.createNotification(notice("AFFILIATE_DEACTIVATED")))?.id, "notice");
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.state.deliveries.length, 1);
    assert.equal(f.state.deliveryStatus, "SENT");
  });
}

test("active accounts continue to receive notifications", async () => {
  const f = fixture("ACTIVE");
  assert.equal((await f.createNotification(notice("PROMO_CODE_APPROVED")))?.id, "notice");
  assert.equal(f.state.deliveries.length, 1);
  assert.equal(f.state.deliveryStatus, "SENT");
});

test("deactivation between notification creation and device lookup prevents push delivery", async () => {
  const f = fixture("ACTIVE");
  f.state.revokeAfterCreate = true;
  await f.createNotification(notice("PROMO_CODE_APPROVED"));
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.tokenReads, 1);
  assert.equal(f.state.deliveries.length, 0);
  assert.equal(f.state.deliveryStatus, "SKIPPED_NO_TOKEN");
});
