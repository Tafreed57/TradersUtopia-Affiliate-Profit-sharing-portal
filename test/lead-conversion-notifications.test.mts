import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { buildCommissionValueNotifications } from "../src/lib/commission-value-notification-data.ts";
import { buildLeadConversionNotifications } from "../src/lib/lead-conversion-notification-data.ts";
import { sanitizeNotificationCopy } from "../src/lib/notification-privacy.ts";

test("lead alerts fan out once per unique affiliate and teacher without money", () => {
  const notifications = buildLeadConversionNotifications({
    referralId: "ref_1",
    affiliateUserId: "affiliate",
    teacherUserIds: ["teacher-1", "teacher-2", "teacher-1"],
  });

  assert.deepEqual(
    notifications.map(({ userId, dedupeKey }) => ({ userId, dedupeKey })),
    [
      { userId: "affiliate", dedupeKey: "lead-conversion:ref_1:affiliate" },
      { userId: "teacher-1", dedupeKey: "lead-conversion:ref_1:teacher-1" },
      { userId: "teacher-2", dedupeKey: "lead-conversion:ref_1:teacher-2" },
    ]
  );

  for (const notification of notifications) {
    assert.equal(notification.type, "CONVERSION_RECEIVED");
    assert.match(notification.title, /Conversion/i);
    assert.match(notification.body, /conversion/i);
    assert.doesNotMatch(notification.body, /\$|CAD|USD|Rewardful/i);
  }
});

test("commission-stage processing sends the amount alert after the lead alert", async () => {
  const [route, engine] = await Promise.all([
    readFile(new URL("../src/app/api/webhooks/rewardful/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/commission-engine.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /isReferralLeadEvent/);
  assert.match(route, /notifyReferralLead/);
  assert.match(engine, /buildCommissionValueNotifications/);
  assert.match(engine, /createNotifications/);
  assert.match(engine, /getCommissionCadAllocation/);
  assert.doesNotMatch(route, /result\.notifications/);
  assert.doesNotMatch(engine, /formatPercent|rate on/);
});

test("stored commission notifications are re-rendered from the current split values", async () => {
  const route = await readFile(
    new URL("../src/app/api/notifications/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(route, /getCommissionValueNotificationCopy/);
  assert.match(route, /getCommissionCadAllocations/);
  assert.match(route, /commissionSplitId/);
  assert.match(route, /providerCutCad/);
});

test("commission value alerts include the saved cut amount without exposing commission rate", () => {
  const notifications = buildCommissionValueNotifications({
    event: {
      id: "event_1",
      rewardfulCommissionId: "comm_1",
      isRecurring: false,
      conversionDate: new Date("2026-06-24T12:00:00.000Z"),
      currency: "CAD",
    },
    splits: [
      {
        id: "split_aff",
        recipientId: "affiliate",
        role: "AFFILIATE",
        cutPercent: "50",
        cutAmount: "62.53",
        providerCutCad: null,
        status: "EARNED",
        recipient: {
          id: "affiliate",
          status: "ACTIVE",
          canSeeRecurringCommissions: true,
          recurringCommissionsVisibleFrom: null,
        },
      },
      {
        id: "split_teacher",
        recipientId: "teacher",
        role: "TEACHER",
        cutPercent: "10",
        cutAmount: "12.50",
        providerCutCad: "12.49",
        status: "EARNED",
        recipient: {
          id: "teacher",
          status: "ACTIVE",
          canSeeRecurringCommissions: true,
          recurringCommissionsVisibleFrom: null,
        },
      },
    ],
  });

  assert.deepEqual(
    notifications.map(({ userId, dedupeKey }) => ({ userId, dedupeKey })),
    [
      { userId: "affiliate", dedupeKey: "commission-value:comm_1:affiliate" },
      { userId: "teacher", dedupeKey: "commission-value:comm_1:teacher" },
    ]
  );

  assert.match(notifications[0].body, /CA\$62\.53/);
  assert.doesNotMatch(notifications[0].body, /50%|rate|percentage/i);
  assert.match(notifications[0].body, /new commission/i);
  assert.match(notifications[1].body, /CA\$12\.49/);
  assert.doesNotMatch(notifications[1].body, /10%|rate|percentage/i);

  for (const notification of notifications) {
    assert.equal(notification.type, "CONVERSION_RECEIVED");
    assert.doesNotMatch(notification.title, /Rewardful/i);
    assert.doesNotMatch(notification.body, /Rewardful/i);
    assert.doesNotMatch(notification.body, /\b\d+(?:\.\d+)?%/);
  }
});

test("USD commission value alerts use provider-matched CAD when available", () => {
  const notifications = buildCommissionValueNotifications({
    event: {
      id: "event_usd",
      rewardfulCommissionId: "comm_usd",
      isRecurring: false,
      conversionDate: new Date("2026-06-26T22:45:30.000Z"),
      currency: "USD",
    },
    splits: [
      {
        id: "split_usd",
        recipientId: "affiliate",
        role: "AFFILIATE",
        cutPercent: "60",
        cutAmount: "44.99",
        providerCutCad: "63.92",
        status: "EARNED",
        recipient: {
          id: "affiliate",
          status: "ACTIVE",
          canSeeRecurringCommissions: true,
          recurringCommissionsVisibleFrom: null,
        },
      },
    ],
  });

  assert.equal(notifications.length, 1);
  assert.match(notifications[0].body, /CA\$63\.92/);
  assert.doesNotMatch(notifications[0].body, /US\$44\.99/);
});

test("USD commission value alerts wait for provider-matched CAD instead of falling back to native split amount", () => {
  const notifications = buildCommissionValueNotifications({
    event: {
      id: "event_unresolved",
      rewardfulCommissionId: "comm_unresolved",
      isRecurring: false,
      conversionDate: new Date("2026-06-26T22:45:30.000Z"),
      currency: "USD",
    },
    splits: [
      {
        id: "split_unresolved",
        recipientId: "affiliate",
        role: "AFFILIATE",
        cutPercent: "60",
        cutAmount: "44.99",
        providerCutCad: null,
        status: "EARNED",
        recipient: {
          id: "affiliate",
          status: "ACTIVE",
          canSeeRecurringCommissions: true,
          recurringCommissionsVisibleFrom: null,
        },
      },
    ],
  });

  assert.deepEqual(notifications, []);
});

test("conversion notification sanitizer removes legacy rate disclosures", () => {
  const initialCopy = sanitizeNotificationCopy(
    "CONVERSION_RECEIVED",
    "Commission Recorded",
    "You earned CA$62.53 at a 50% rate on a new commission."
  );
  assert.equal(
    initialCopy.body,
    "You earned CA$62.53 on a new commission."
  );
  assert.doesNotMatch(initialCopy.body, /50%|rate|percentage|percent/i);

  const recurringCopy = sanitizeNotificationCopy(
    "CONVERSION_RECEIVED",
    "Recurring Commission Recorded",
    "You earned CA$75.00 (60% rate) on a recurring commission."
  );
  assert.equal(
    recurringCopy.body,
    "You earned CA$75.00 on a recurring commission."
  );
  assert.doesNotMatch(recurringCopy.body, /60%|rate|percentage|percent/i);

  const fallbackCopy = sanitizeNotificationCopy(
    "CONVERSION_RECEIVED",
    "Commission Recorded",
    "You earned CA$62.53 based on your commission percentage."
  );
  assert.equal(fallbackCopy.body, "You earned CA$62.53 on a new commission.");
  assert.doesNotMatch(fallbackCopy.body, /rate|percentage|percent/i);
});

test("recurring value alerts respect each recipient's recurring hide toggle", () => {
  const notifications = buildCommissionValueNotifications({
    event: {
      id: "event_2",
      rewardfulCommissionId: "comm_2",
      isRecurring: true,
      conversionDate: new Date("2026-06-24T12:00:00.000Z"),
      currency: "CAD",
    },
    splits: [
      {
        id: "split_not_hidden",
        recipientId: "not-hidden",
        role: "AFFILIATE",
        cutPercent: "60",
        cutAmount: "75",
        providerCutCad: null,
        status: "EARNED",
        recipient: {
          id: "not-hidden",
          status: "ACTIVE",
          canSeeRecurringCommissions: false,
          recurringCommissionsVisibleFrom: null,
        },
      },
      {
        id: "split_hidden",
        recipientId: "hidden",
        role: "TEACHER",
        cutPercent: "20",
        cutAmount: "25",
        providerCutCad: null,
        status: "EARNED",
        recipient: {
          id: "hidden",
          status: "ACTIVE",
          canSeeRecurringCommissions: true,
          recurringCommissionsVisibleFrom: null,
        },
      },
    ],
  });

  assert.deepEqual(notifications.map((n) => n.userId), ["not-hidden"]);
  assert.match(notifications[0].title, /Recurring Commission/i);
  assert.match(notifications[0].body, /CA\$75\.00/);
  assert.doesNotMatch(notifications[0].body, /60%|rate|percentage/i);
  assert.match(notifications[0].body, /recurring commission/i);
});

test("recurring value alerts respect from-now hide cutoffs", () => {
  const notifications = buildCommissionValueNotifications({
    event: {
      id: "event_3",
      rewardfulCommissionId: "comm_3",
      isRecurring: true,
      conversionDate: new Date("2026-06-25T12:00:00.000Z"),
      currency: "CAD",
    },
    splits: [
      {
        id: "split_cutoff_hidden_future",
        recipientId: "cutoff-hidden-future",
        role: "AFFILIATE",
        cutPercent: "50",
        cutAmount: "62.53",
        providerCutCad: null,
        status: "EARNED",
        recipient: {
          id: "cutoff-hidden-future",
          status: "ACTIVE",
          canSeeRecurringCommissions: true,
          recurringCommissionsVisibleFrom: new Date("2026-06-24T12:00:00.000Z"),
        },
      },
      {
        id: "split_not_hidden",
        recipientId: "not-hidden",
        role: "TEACHER",
        cutPercent: "20",
        cutAmount: "25",
        providerCutCad: null,
        status: "EARNED",
        recipient: {
          id: "not-hidden",
          status: "ACTIVE",
          canSeeRecurringCommissions: false,
          recurringCommissionsVisibleFrom: null,
        },
      },
    ],
  });

  assert.deepEqual(notifications.map((n) => n.userId), ["not-hidden"]);
});

test("recurring value alerts keep old rows before a from-now hide cutoff", () => {
  const notifications = buildCommissionValueNotifications({
    event: {
      id: "event_4",
      rewardfulCommissionId: "comm_4",
      isRecurring: true,
      conversionDate: new Date("2026-06-23T12:00:00.000Z"),
      currency: "CAD",
    },
    splits: [
      {
        id: "split_cutoff_visible_old",
        recipientId: "cutoff-visible-old",
        role: "AFFILIATE",
        cutPercent: "50",
        cutAmount: "62.53",
        providerCutCad: null,
        status: "EARNED",
        recipient: {
          id: "cutoff-visible-old",
          status: "ACTIVE",
          canSeeRecurringCommissions: true,
          recurringCommissionsVisibleFrom: new Date("2026-06-24T12:00:00.000Z"),
        },
      },
    ],
  });

  assert.deepEqual(notifications.map((n) => n.userId), [
    "cutoff-visible-old",
  ]);
});
