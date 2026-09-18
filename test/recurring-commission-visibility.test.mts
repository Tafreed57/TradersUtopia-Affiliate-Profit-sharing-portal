import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  applyRecurringCommissionVisibility,
  getCommissionAffiliateVisibilityReason,
  isCommissionVisibleToAffiliate,
} from "../src/lib/commission-visibility.ts";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const affiliatePortalDataPath = new URL(
  "../src/lib/affiliate-portal-data.ts",
  import.meta.url
);
const dashboardStatsRoutePath = new URL(
  "../src/app/api/dashboard/stats/route.ts",
  import.meta.url
);
const adminAffiliateRoutePath = new URL(
  "../src/app/api/admin/affiliates/[id]/route.ts",
  import.meta.url
);
const adminAffiliateCommissionsRoutePath = new URL(
  "../src/app/api/admin/affiliates/[id]/commissions/route.ts",
  import.meta.url
);
const adminAffiliateLifetimeStatsRoutePath = new URL(
  "../src/app/api/admin/affiliates/[id]/lifetime-stats/route.ts",
  import.meta.url
);
const adminWorkspacePath = new URL(
  "../src/components/admin/managed-affiliate-workspace.tsx",
  import.meta.url
);

test("recurring hide setting off leaves commission history unchanged", () => {
  const since = new Date("2026-06-01T00:00:00.000Z");
  const original = {
    role: "AFFILIATE" as const,
    recipientId: "user_123",
    event: { conversionDate: { gte: since } },
  };

  const where = applyRecurringCommissionVisibility(original, {
    canSeeRecurringCommissions: false,
  });

  assert.deepEqual(where, original);
});

test("all-history recurring hide excludes recurring rows without losing filters", () => {
  const until = new Date("2026-06-30T23:59:59.999Z");
  const where = applyRecurringCommissionVisibility(
    {
      role: "AFFILIATE",
      recipientId: "user_123",
      event: { conversionDate: { lte: until } },
    },
    { canSeeRecurringCommissions: true, recurringCommissionsVisibleFrom: null }
  );

  assert.deepEqual(where, {
    role: "AFFILIATE",
    recipientId: "user_123",
    event: {
      conversionDate: { lte: until },
      isRecurring: false,
    },
  });
});

test("from-now recurring hide keeps old rows and hides new recurring rows", () => {
  const since = new Date("2026-06-01T00:00:00.000Z");
  const hideFrom = new Date("2026-06-24T12:00:00.000Z");
  const where = applyRecurringCommissionVisibility(
    {
      role: "AFFILIATE",
      recipientId: "user_123",
      event: { conversionDate: { gte: since } },
    },
    {
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: hideFrom,
    }
  );

  assert.deepEqual(where, {
    AND: [
      {
        role: "AFFILIATE",
        recipientId: "user_123",
        event: { conversionDate: { gte: since } },
      },
      {
        OR: [
          { event: { isRecurring: false } },
          {
            event: {
              isRecurring: true,
              conversionDate: { lt: hideFrom },
            },
          },
        ],
      },
    ],
  });
});

test("admin row markers mirror what the affiliate can actually see", () => {
  const hideFrom = new Date("2026-06-24T12:00:00.000Z");
  const firstTimeRow = {
    isRecurring: false,
    conversionDate: new Date("2026-06-01T00:00:00.000Z"),
  };
  const oldRecurringRow = {
    isRecurring: true,
    conversionDate: new Date("2026-06-20T00:00:00.000Z"),
  };
  const futureRecurringRow = {
    isRecurring: true,
    conversionDate: new Date("2026-06-25T00:00:00.000Z"),
  };

  assert.equal(
    isCommissionVisibleToAffiliate(firstTimeRow, {
      canSeeRecurringCommissions: false,
    }),
    true
  );
  assert.equal(
    getCommissionAffiliateVisibilityReason(firstTimeRow, {
      canSeeRecurringCommissions: false,
    }),
    "first_time_commission"
  );
  assert.equal(
    isCommissionVisibleToAffiliate(oldRecurringRow, {
      canSeeRecurringCommissions: false,
    }),
    true
  );
  assert.equal(
    getCommissionAffiliateVisibilityReason(oldRecurringRow, {
      canSeeRecurringCommissions: false,
    }),
    "recurring_visible"
  );
  assert.equal(
    isCommissionVisibleToAffiliate(oldRecurringRow, {
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: null,
    }),
    false
  );
  assert.equal(
    getCommissionAffiliateVisibilityReason(oldRecurringRow, {
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: null,
    }),
    "recurring_hidden_all_history"
  );
  assert.equal(
    isCommissionVisibleToAffiliate(oldRecurringRow, {
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: hideFrom,
    }),
    true
  );
  assert.equal(
    getCommissionAffiliateVisibilityReason(oldRecurringRow, {
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: hideFrom,
    }),
    "recurring_visible_before_hide_from"
  );
  assert.equal(
    isCommissionVisibleToAffiliate(futureRecurringRow, {
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: hideFrom,
    }),
    false
  );
  assert.equal(
    getCommissionAffiliateVisibilityReason(futureRecurringRow, {
      canSeeRecurringCommissions: true,
      recurringCommissionsVisibleFrom: hideFrom,
    }),
    "recurring_hidden_after_hide_from"
  );
});

test("affiliate-facing commission surfaces use the recurring hide rule", async () => {
  const [affiliatePortalData, dashboardStatsRoute] = await Promise.all([
    readFile(affiliatePortalDataPath, "utf8"),
    readFile(dashboardStatsRoutePath, "utf8"),
  ]);

  assert.match(affiliatePortalData, /canSeeRecurringCommissions/);
  assert.match(affiliatePortalData, /recurringCommissionsVisibleFrom/);
  assert.match(affiliatePortalData, /applyRecurringCommissionVisibility/);
  assert.match(dashboardStatsRoute, /canSeeRecurringCommissions/);
  assert.match(dashboardStatsRoute, /recurringCommissionsVisibleFrom/);
  assert.match(dashboardStatsRoute, /applyRecurringCommissionVisibility/);
});

test("recurring visibility only hides row history, not affiliate money totals", async () => {
  const [affiliatePortalData, dashboardStatsRoute] = await Promise.all([
    readFile(affiliatePortalDataPath, "utf8"),
    readFile(dashboardStatsRoutePath, "utf8"),
  ]);

  const commissionsListBlock = affiliatePortalData.slice(
    affiliatePortalData.indexOf("export async function getAffiliateCommissionsData"),
    affiliatePortalData.indexOf("export async function getAffiliateAttendanceData")
  );
  const lifetimeTotalsBlock = affiliatePortalData.slice(
    affiliatePortalData.indexOf("export async function getAffiliateLifetimeStatsData"),
    affiliatePortalData.indexOf("async function getTeacherEpisodeSummaries")
  );
  const earnedSummaryBlock = affiliatePortalData.slice(
    affiliatePortalData.indexOf("export async function getAffiliateEarnedSummaryCad")
  );

  assert.match(commissionsListBlock, /applyRecurringCommissionVisibility/);
  assert.doesNotMatch(lifetimeTotalsBlock, /applyRecurringCommissionVisibility/);
  assert.doesNotMatch(earnedSummaryBlock, /applyRecurringCommissionVisibility/);

  assert.match(dashboardStatsRoute, /visibleAffiliateSplitWhere/);
  assert.match(dashboardStatsRoute, /where:\s*affiliateSplitWhere[\s\S]*commissionCount/);
  assert.match(dashboardStatsRoute, /where:\s*visibleAffiliateSplitWhere[\s\S]*recentSplits/);
});

test("admin can toggle recurring visibility and that setting remains silent", async () => {
  const [adminRoute, adminWorkspace] = await Promise.all([
    readFile(adminAffiliateRoutePath, "utf8"),
    readFile(adminWorkspacePath, "utf8"),
  ]);

  assert.match(adminRoute, /canSeeRecurringCommissions:\s*z\.boolean\(\)\.optional\(\)/);
  assert.match(adminRoute, /recurringCommissionVisibilityMode:\s*z\.enum/);
  assert.match(adminRoute, /updateData\.canSeeRecurringCommissions/);
  assert.match(adminRoute, /updateData\.recurringCommissionsVisibleFrom/);
  assert.match(adminWorkspace, /canSeeRecurringCommissions/);
  assert.match(adminWorkspace, /recurringCommissionVisibilityMode/);
  assert.match(adminWorkspace, /Hide recurring commission rows/);
  assert.match(adminWorkspace, /recurringVisibilityDialogOpen/);
  assert.match(adminWorkspace, /Choose recurring rows to hide/);
  assert.match(adminWorkspace, /Save hide rule/);
  assert.match(adminWorkspace, /Hide from now onward/);
  assert.doesNotMatch(
    adminWorkspace,
    /onValueChange=\{\(value\)\s*=>\s*updateMutation\.mutate/
  );

  const visibilityIndex = adminRoute.indexOf("canSeeRecurringCommissions");
  assert.notEqual(visibilityIndex, -1);
  const statusIndex = adminRoute.indexOf("if (status !== undefined)", visibilityIndex);
  const visibilityUpdateBlock = adminRoute.slice(visibilityIndex, statusIndex);
  assert.doesNotMatch(visibilityUpdateBlock, /createNotification/);
});

test("admin commission audit routes keep full history and full totals", async () => {
  const [commissionsRoute, lifetimeStatsRoute, adminWorkspace] = await Promise.all([
    readFile(adminAffiliateCommissionsRoutePath, "utf8"),
    readFile(adminAffiliateLifetimeStatsRoutePath, "utf8"),
    readFile(adminWorkspacePath, "utf8"),
  ]);

  assert.match(commissionsRoute, /respectRecurringVisibility:\s*false/);
  assert.match(commissionsRoute, /includeAffiliateVisibility:\s*true/);
  assert.doesNotMatch(lifetimeStatsRoute, /respectRecurringVisibility/);
  assert.match(adminWorkspace, /AffiliateVisibilityBadge/);
  assert.match(adminWorkspace, /Affiliate View/);
  assert.match(adminWorkspace, /Visible to affiliate/);
  assert.match(adminWorkspace, /Hidden from affiliate/);
});

test("new users default to no recurring history manipulation", async () => {
  const schema = await readFile(schemaPath, "utf8");

  assert.match(
    schema,
    /canSeeRecurringCommissions\s+Boolean\s+@default\(false\)/
  );
  assert.match(schema, /recurringCommissionsVisibleFrom\s+DateTime\?/);
});
