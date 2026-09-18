# Lead Alerts, Provider-Matched Commissions, and Test Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move conversion alerts to `referral.lead`, make all core CAD commission values match upstream state totals without today's FX rate, and prevent generated E2E users from persisting.

**Architecture:** Add a retry-safe lead notification service and a pure Decimal-based CAD allocator backed by the existing lifetime JSON cache. API responses expose provider-anchored CAD amounts beside native commission amounts, allowing CAD views to avoid live FX while preserving native USD rows. Generated registration users are removed by Playwright teardown.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma/PostgreSQL, Decimal.js, Node test runner, Playwright.

---

### Task 1: Retry-safe lead notification parsing and persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260617120000_notification_dedupe_key/migration.sql`
- Modify: `src/lib/rewardful-webhook-parser.ts`
- Modify: `src/lib/notifications.ts`
- Test: `test/rewardful-webhook-parser.test.mts`
- Test: `test/notification-dedupe.test.mts`

- [ ] **Step 1: Write parser tests that fail for lead recognition and extraction**

```ts
test("referral.lead extracts referral and affiliate ids", () => {
  const payload = {
    event: { type: "referral.lead" },
    object: { id: "ref_1", affiliate: { id: "aff_1" } },
  };
  assert.equal(isReferralLeadEvent(extractEventType(payload)), true);
  assert.deepEqual(extractReferralLead(payload), {
    referralId: "ref_1",
    affiliateRewardfulId: "aff_1",
  });
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/rewardful-webhook-parser.test.mts`

Expected: FAIL because `isReferralLeadEvent` and `extractReferralLead` are not exported.

- [ ] **Step 3: Add lead parser helpers**

```ts
export function isReferralLeadEvent(event: unknown): boolean {
  return typeof event === "string" && event.toLowerCase() === "referral.lead";
}

export function extractReferralLead(payload: Record<string, unknown>) {
  const data = extractCommissionObject(payload);
  const referralId = getString(data, "id");
  const affiliateRewardfulId =
    getString(data, "affiliate_id") ??
    getString((data.affiliate as Record<string, unknown>) ?? {}, "id");
  return referralId && affiliateRewardfulId
    ? { referralId, affiliateRewardfulId }
    : null;
}
```

- [ ] **Step 4: Add database-backed notification idempotency**

Add `dedupeKey String? @unique` to `Notification`, create the matching SQL migration, and extend `CreateNotificationParams`. `createNotification` must catch only the `Notification_dedupeKey_key`/`dedupeKey` P2002 collision and return `{ skipped: true }` before push delivery.

- [ ] **Step 5: Run parser and notification tests and verify GREEN**

Run: `npm run test:unit -- --test-name-pattern="lead|dedupe"`

Expected: all selected tests pass.

### Task 2: Move conversion alerts to referral.lead

**Files:**
- Create: `src/lib/lead-conversion-notifications.ts`
- Modify: `src/app/api/webhooks/rewardful/route.ts`
- Modify: `src/lib/commission-engine.ts`
- Test: `test/lead-conversion-notifications.test.mts`
- Test: `test/commission-engine-notifications.test.mts`

- [ ] **Step 1: Write failing recipient/copy tests**

```ts
assert.deepEqual(
  buildLeadConversionNotifications({
    referralId: "ref_1",
    affiliateUserId: "student",
    teacherUserIds: ["teacher", "teacher-2"],
  }),
  [
    { userId: "student", dedupeKey: "lead-conversion:ref_1:student" },
    { userId: "teacher", dedupeKey: "lead-conversion:ref_1:teacher" },
    { userId: "teacher-2", dedupeKey: "lead-conversion:ref_1:teacher-2" },
  ].map((item) => ({
    ...item,
    type: "CONVERSION_RECEIVED",
    title: "New Conversion",
    body: "A new conversion was recorded.",
    data: { referralId: "ref_1" },
  }))
);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/lead-conversion-notifications.test.mts test/commission-engine-notifications.test.mts`

Expected: FAIL because the lead service does not exist and commission conversion still emits notifications.

- [ ] **Step 3: Implement lead recipients and route handling**

Resolve the affiliate by `rewardfulAffiliateId`, resolve active depth-1/depth-2 teacher rows, de-duplicate recipient ids, and create generic notifications. Handle `referral.lead` before the commission-event ignore branch.

- [ ] **Step 4: Remove commission-stage notification generation**

Delete the notification construction block from `processConversion` and remove the later `createNotifications(result.notifications)` call. Accounting behavior remains unchanged.

- [ ] **Step 5: Run notification tests and verify GREEN**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/lead-conversion-notifications.test.mts test/commission-engine-notifications.test.mts test/rewardful-webhook-parser.test.mts`

Expected: all tests pass and copy contains neither amounts nor provider names.

### Task 3: Pure provider-anchored CAD allocator

**Files:**
- Create: `src/lib/commission-cad-allocation.ts`
- Test: `test/commission-cad-allocation.test.mts`

- [ ] **Step 1: Write failing pure allocation tests**

Cover Linda/Mario (`8886.40 * 20% = 1777.28`), mixed CAD/USD events, exact percentage arithmetic, paid/due/pending separation, void exclusion, and per-row allocations summing to the aggregate.

```ts
assert.equal(
  allocateStateCad({
    upstreamCad: "8886.40",
    events: [{ id: "e1", currency: "USD", fullAmount: "6503.97" }],
  }).eventCad.get("e1")?.toFixed(2),
  "8886.40"
);
assert.equal(allocateCutCad("8886.40", "20").toFixed(2), "1777.28");
```

- [ ] **Step 2: Run allocator tests and verify RED**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/commission-cad-allocation.test.mts`

Expected: FAIL because the allocator does not exist.

- [ ] **Step 3: Implement Decimal-based allocation**

Implement state classification, `pending = max(unpaid - due, 0)`, CAD-native subtraction, USD remainder allocation, exact split multiplication, and output rounding only at API boundaries.

- [ ] **Step 4: Run allocator tests and verify GREEN**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/commission-cad-allocation.test.mts`

Expected: all allocator tests pass.

### Task 4: Upstream state cache and affiliate surfaces

**Files:**
- Modify: `src/lib/affiliate-portal-data.ts`
- Modify: `src/lib/commission-cache.ts`
- Modify: `src/app/api/dashboard/stats/route.ts`
- Modify: `src/app/api/admin/affiliates/[id]/route.ts`
- Modify: `src/app/(dashboard)/page.tsx`
- Modify: `src/app/(dashboard)/commissions/page.tsx`
- Modify: `src/components/admin/managed-affiliate-workspace.tsx`
- Test: `test/affiliate-cad-summary.test.mts`

- [ ] **Step 1: Write failing summary mapping tests**

Assert due/pending/paid totals are built from upstream CAD state bases and exact local percentages, and assert voided splits never contribute.

- [ ] **Step 2: Run the summary test and verify RED**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/affiliate-cad-summary.test.mts`

Expected: FAIL because the mapping helper is not wired.

- [ ] **Step 3: Cache upstream state bases independently**

Store `upstreamCadBase: { paidCad, unpaidCad, dueCad, pendingCad, fetchedAt }` in `lifetimeStatsJson`. Teacher-only refreshes preserve the existing object and do not update `lifetimeStatsCachedAt`. On fetch failure, use the last base with `stale: true`; if no base exists, return an unavailable reason instead of live FX.

- [ ] **Step 4: Replace affiliate live-FX totals**

Update lifetime, dashboard, and admin aggregate queries to request provider-anchored allocations. Add `affiliateCutCad` to commission row DTOs while preserving `affiliateCut` and native `currency`.

- [ ] **Step 5: Make CAD row rendering use `affiliateCutCad`**

When the selected display currency is CAD, render the server-provided CAD amount directly. When USD is selected and the event is USD, render the native amount directly. Existing display-rate conversion remains only for a native-CAD row shown in USD.

- [ ] **Step 6: Run affiliate tests and verify GREEN**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/commission-cad-allocation.test.mts test/affiliate-cad-summary.test.mts`

Expected: all tests pass.

### Task 5: Teacher, relationship, and commission-detail surfaces

**Files:**
- Modify: `src/lib/rewardful-student-stats.ts`
- Modify: `src/lib/teacher-student-relationships.ts`
- Modify: `src/lib/affiliate-portal-data.ts`
- Modify: `src/app/(dashboard)/students/page.tsx`
- Modify: `src/components/admin/managed-affiliate-workspace.tsx`
- Modify: `src/components/admin/restore-gap-approval-dialog.tsx`
- Test: `test/teacher-cad-summary.test.mts`

- [ ] **Step 1: Write failing teacher tests**

Test active and archived relationship episodes, due/pending/paid state separation, void exclusion, and exact cut percentages. Include the production-derived Linda/Mario expected value of `1777.28`.

- [ ] **Step 2: Run teacher tests and verify RED**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/teacher-cad-summary.test.mts`

Expected: FAIL because teacher summaries still call `getCadToUsdRate()`.

- [ ] **Step 3: Replace teacher live-FX paths**

Use provider allocations in `getTeacherEpisodeSummaries`, `getTeacherStudentSplitStats`, relationship snapshots, restore previews, and teacher detail rows. Add `teacherCutCad` to row DTOs.

- [ ] **Step 4: Render server CAD values directly**

Teacher/student CAD cards and CAD commission rows use `teacherCutCad`; native USD mode continues to use `teacherCut` for USD events.

- [ ] **Step 5: Run teacher tests and verify GREEN**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/commission-cad-allocation.test.mts test/teacher-cad-summary.test.mts`

Expected: all tests pass.

### Task 6: E2E user teardown and production cleanup verification

**Files:**
- Create: `e2e/test-user-fixture.ts`
- Modify: `e2e/auth.spec.ts`
- Modify: `e2e/dashboard.spec.ts`
- Test: `test/e2e-test-user-cleanup.test.mts`

- [ ] **Step 1: Write a failing cleanup guard test**

Assert both registration suites register generated emails through the shared fixture and that the fixture always deletes tracked `@example.com` users in `afterEach`/`afterAll` cleanup.

- [ ] **Step 2: Implement tracked teardown**

Use a worker-local set of generated emails and Prisma cleanup in a `finally`-safe fixture. Restrict deletion to the three exact generated names and `@example.com` addresses.

- [ ] **Step 3: Run cleanup tests**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/e2e-test-user-cleanup.test.mts`

Expected: PASS.

- [ ] **Step 4: Verify production remains clean**

Run the read-only Prisma query for the exact three test names and `@example.com` domain.

Expected: `0` users.

### Task 7: Full verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm run test:unit`

Expected: zero failures.

- [ ] **Step 2: Run notification privacy validation**

Run: `npm run test:notification-privacy`

Expected: zero violations.

- [ ] **Step 3: Run lint and typecheck**

Run: `npm run lint`

Run: `npx tsc --noEmit`

Expected: both exit 0.

- [ ] **Step 4: Run the production-derived Linda/Mario audit**

Expected: four voided events excluded and due CAD equals `1777.28` for Mario's 20% share.

- [ ] **Step 5: Inspect the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only scoped source, migration, test, and documentation changes plus the prior approved admin-rate-notification change.

## Plan Self-Review

- Spec coverage: every requirement maps to Tasks 1-7.
- Placeholder scan: no TBD/TODO steps remain.
- Type consistency: row DTOs consistently use `affiliateCutCad` and `teacherCutCad`; the cache consistently uses `upstreamCadBase`.
- Scope separation: NURSE promo-code investigation is not mixed into this plan.
