import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPANY_PERFORMANCE_TIME_ZONE,
  getTorontoMonthComparisonWindows,
  getTorontoReportingWindow,
  shapeCompanyPerformancePayload,
} from "../src/lib/company-performance.ts";
import { firstTimeSignupEventWhere } from "../src/lib/signup-conversions.ts";
import { planCompleteTeacherStudentRemoval } from "../src/lib/teacher-student-removal.ts";

test("company performance windows use Toronto business time", () => {
  const now = new Date("2026-05-24T15:30:00.000Z");

  const today = getTorontoReportingWindow("today", now);
  const week = getTorontoReportingWindow("week", now);
  const month = getTorontoReportingWindow("month", now);

  assert.equal(COMPANY_PERFORMANCE_TIME_ZONE, "America/Toronto");
  assert.equal(today.timezoneLabel, "Toronto time");
  assert.equal(today.start.toISOString(), "2026-05-24T04:00:00.000Z");
  assert.equal(today.end.toISOString(), now.toISOString());
  assert.equal(week.start.toISOString(), "2026-05-18T04:00:00.000Z");
  assert.equal(week.end.toISOString(), now.toISOString());
  assert.equal(month.start.toISOString(), "2026-05-01T04:00:00.000Z");
  assert.equal(month.end.toISOString(), now.toISOString());
});

test("monthly conversion comparison uses current and previous Toronto months", () => {
  const now = new Date("2026-05-24T15:30:00.000Z");
  const windows = getTorontoMonthComparisonWindows(now);

  assert.equal(windows.timezoneLabel, "Toronto time");
  assert.equal(windows.current.start.toISOString(), "2026-05-01T04:00:00.000Z");
  assert.equal(windows.current.end.toISOString(), now.toISOString());
  assert.equal(windows.previous.start.toISOString(), "2026-04-01T04:00:00.000Z");
  assert.equal(windows.previous.end.toISOString(), "2026-05-01T04:00:00.000Z");
});

test("signup conversion filters exclude recurring commission events", () => {
  const dateFilter = {
    gte: new Date("2026-05-01T04:00:00.000Z"),
    lt: new Date("2026-05-24T15:30:00.000Z"),
  };

  assert.deepEqual(
    firstTimeSignupEventWhere({
      affiliateId: { in: ["user_alpha", "user_bravo"] },
      conversionDate: dateFilter,
    }),
    {
      affiliateId: { in: ["user_alpha", "user_bravo"] },
      conversionDate: dateFilter,
      isRecurring: false,
    }
  );
});

test("company performance totals include hidden affiliates while public rows stay private", () => {
  const publicPayload = shapeCompanyPerformancePayload({
    range: "month",
    window: getTorontoReportingWindow(
      "month",
      new Date("2026-05-24T15:30:00.000Z")
    ),
    affiliates: [
      {
        affiliateId: "aff_alpha",
        displayName: "Alpha Team",
        email: "alpha@example.com",
        conversions: 4,
        paidCommissionCents: 10_000,
        visible: true,
      },
      {
        affiliateId: "aff_hidden",
        displayName: "Hidden Team",
        email: "hidden@example.com",
        conversions: 10,
        paidCommissionCents: 20_000,
        visible: false,
      },
      {
        affiliateId: "aff_bravo",
        displayName: "Bravo Team",
        email: "bravo@example.com",
        conversions: 7,
        paidCommissionCents: 15_000,
        visible: true,
      },
    ],
    includeFinancials: false,
  });

  assert.equal(publicPayload.totals.conversions, 21);
  assert.equal(publicPayload.totals.affiliateCount, 3);
  assert.equal(publicPayload.totals.hiddenAffiliateCount, 1);
  assert.deepEqual(
    publicPayload.leaderboard.map((row) => [row.rank, row.affiliateId, row.conversions]),
    [
      [1, "aff_bravo", 7],
      [2, "aff_alpha", 4],
    ]
  );
  assert.equal("email" in publicPayload.leaderboard[0], false);
  assert.equal("paidCommissionCents" in publicPayload.leaderboard[0], false);
  assert.equal("totalPaidCommissionCents" in publicPayload.totals, false);

  const adminPayload = shapeCompanyPerformancePayload({
    ...publicPayload.source,
    includeFinancials: true,
  });

  assert.equal(adminPayload.totals.totalPaidCommissionCents, 45_000);
  assert.equal(adminPayload.leaderboard[0].email, "bravo@example.com");
  assert.equal(adminPayload.leaderboard[0].paidCommissionCents, 15_000);
});

test("complete removal preserves indirect teacher-student links", () => {
  const plan = planCompleteTeacherStudentRemoval({
    relationship: {
      id: "rel_a_b",
      depth: 1,
    },
    activeIndirectRelationships: [
      { id: "rel_a_c", studentId: "student_c" },
      { id: "rel_a_d", studentId: "student_d" },
    ],
  });

  assert.deepEqual(plan.relationshipIdsToDeactivate, ["rel_a_b"]);
  assert.deepEqual(plan.preservedIndirectRelationshipIds, [
    "rel_a_c",
    "rel_a_d",
  ]);
});

test("complete removal is limited to direct teacher-student links", () => {
  assert.throws(
    () =>
      planCompleteTeacherStudentRemoval({
        relationship: {
          id: "rel_a_c",
          depth: 2,
        },
        activeIndirectRelationships: [],
      }),
    /Only direct student relationships/
  );
});
