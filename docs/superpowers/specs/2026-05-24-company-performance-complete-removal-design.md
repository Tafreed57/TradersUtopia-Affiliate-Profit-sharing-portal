# Company Performance and Complete Relationship Removal Design

## Title and Metadata

- **Author:** Codex
- **Date:** 2026-05-24
- **Status:** Approved direction, pending implementation plan
- Reviewers: Tafreed
- Project: TradersUtopia Affiliate Commission Portal

## Context

Affiliates asked for better visibility into monthly commission activity, signups, and who is leading. In this portal, "signups" means conversions from the affiliate system, not portal account registrations. The dashboard currently shows a user's own earned totals, recent commissions, and attendance, but it does not show company-wide conversion performance or leaderboard context.

Admins also need a stronger relationship removal tool. The existing removal flow archives a teacher-student relationship and preserves visible previous-student payout history. That is useful for normal teacher offboarding, but admins also need a way to remove a student from a teacher's visible/calculated roster as though the direct relationship was never there, without hard-deleting accounting records or voiding historical commissions.

All frontend text must preserve the vendor opacity rule. Backend code and internal docs may mention the external affiliate provider, but user-facing labels, copy, errors, toasts, and tooltips must present the data as TradersUtopia's own affiliate system.

## Functional Requirements

- FR-1: The dashboard MUST show the authenticated user's personal commission summary, including total earned, this-month earned, paid-this-month, total commissions, and attendance days this month.

- FR-2: The dashboard MUST show a company-wide performance section sourced from all affiliates in the affiliate system, including affiliates who do not have portal accounts.

- FR-3: Company-wide performance shown to regular affiliates MUST expose conversion counts and leaderboard rank only. It MUST NOT expose company-wide revenue, gross conversion amounts, or payout amounts.

- FR-4: Admin users MAY see additional company-wide money metrics in admin-only surfaces, but these fields MUST NOT be included in regular affiliate API responses.

- FR-5: The company performance section MUST support `today`, `thisWeek`, and `thisMonth` range filters.

- FR-6: All company performance ranges MUST use `America/Toronto` business time, and the UI MUST show that the window is in Toronto time.

- FR-7: The leaderboard MUST rank affiliates by conversion count for the selected range.

- FR-8: The leaderboard MUST count hidden affiliates in company-wide totals while excluding hidden affiliates from public leaderboard rows.

- FR-9: Admin users MUST be able to toggle whether an affiliate appears on regular affiliate leaderboards.

- FR-10: Regular affiliate leaderboard rows MUST avoid exposing email addresses. Rows SHOULD use display names or privacy-safe fallbacks.

- FR-11: The commissions page SHOULD show current-month and previous-month conversion counts for the authenticated user.

- FR-12: Admin users MUST have a separate "complete remove" action for direct teacher-student relationships, distinct from the existing safe archive action.

- FR-13: Complete remove MUST deactivate the selected direct teacher-student relationship and hide it from teacher-facing previous-student history.

- FR-14: Complete remove MUST stop future direct teacher earnings from that removed student.

- FR-15: Complete remove MUST preserve existing indirect relationships. If `A -> B -> C` exists and admin completely removes `B` from `A`, `A -> C` MUST remain active unless the admin separately removes it.

- FR-16: Complete remove MUST affect only the selected teacher's relationship. Other teachers for the same student MUST remain untouched.

- FR-17: Complete remove MUST NOT hard-delete commission events, commission splits, users, attendance, promo-code requests, or audit records.

- FR-18: Complete remove MUST NOT mark historical commissions as `VOIDED`.

- FR-19: Complete remove MUST keep enough admin/internal audit information to explain who performed the action, when, and why.

## Non-Functional Requirements

NFR-1. Company performance API responses for regular affiliates MUST complete from local cache under normal operation.

NFR-2. Cache refreshes SHOULD tolerate external API failure by serving the last successful snapshot with a stale indicator.

NFR-3. Leaderboard refresh work MUST be bounded for the current scale of 50-100 affiliates and should remain practical for a few hundred affiliates.

NFR-4. Admin relationship removal MUST be transactionally safe: the direct relationship, hidden archive state, and audit metadata must update together.

NFR-5. The UI MUST remain mobile-friendly and avoid oversized marketing-style layouts. This is an operational dashboard feature.

NFR-6. User-facing strings MUST NOT mention the external affiliate provider name.

## Acceptance Criteria

### AC-1: Personal paid metric appears (FR-1)

Given a regular affiliate opens the dashboard.
When the stats load.
Then they see personal totals including "Paid this month".

### AC-2: Regular company view excludes money (FR-2, FR-3)

Given a regular affiliate opens the dashboard.
When company performance loads.
Then they see total company conversions and a leaderboard for the selected range without company-wide money.

### AC-3: Admin company view may include admin money fields (FR-4)

Given an admin opens the company performance surface.
When admin data is loaded.
Then admin-only money fields may be present and regular affiliate responses still exclude those fields.

### AC-4: Range switching uses Toronto windows (FR-5, FR-6)

Given the user changes the range to Today, This Week, or This Month.
When the request completes.
Then the company totals and leaderboard update using Toronto time.

### AC-5: Toronto time is visible (FR-6)

Given a company performance range is displayed.
When the user reads the section.
Then the UI includes a Toronto-time label for the date window.

### AC-6: Leaderboard ranks by conversions (FR-7)

Given a selected company performance range.
When leaderboard rows are displayed.
Then rows are ordered by conversion count for that range.

### AC-7: Hidden affiliates stay in totals (FR-8, FR-9)

Given an admin hides an affiliate from the leaderboard.
When regular affiliates view the leaderboard.
Then that affiliate is absent from ranking rows but their conversions remain included in company totals.

### AC-8: Hidden affiliates can return (FR-9)

Given an admin shows the affiliate again.
When regular affiliates view the leaderboard.
Then the affiliate can appear in the relevant ranking rows.

### AC-9: Regular leaderboard rows hide emails (FR-10)

Given a regular affiliate views leaderboard rows.
When the leaderboard renders.
Then no row displays an email address.

### AC-10: Commissions page shows conversion counts (FR-11)

Given the authenticated user opens the commissions page.
When the page summary loads.
Then they can see their conversion count for this month and previous month.

### AC-11: Safe archive remains unchanged (FR-12)

Given admin performs the existing safe remove action.
When the request succeeds.
Then behavior remains unchanged: the relationship is archived and visible in previous-student history when configured that way.

### AC-12: Complete remove hides direct relationship (FR-12, FR-13, FR-14, FR-19)

Given admin performs complete remove on `A -> B`.
When the request succeeds.
Then `A -> B` becomes inactive, hidden from teacher-facing active and previous-student lists, unavailable for future direct teacher earnings, and recorded with admin audit context.

### AC-13: Complete remove preserves indirect entitlement (FR-15)

Given `A -> B -> C` exists and admin complete-removes `A -> B`.
When the request succeeds.
Then `A -> C` remains active and continues contributing to A's indirect teacher totals.

### AC-14: Complete remove leaves other teachers untouched (FR-16)

Given B has another teacher D.
When admin complete-removes `A -> B`.
Then `D -> B` remains active.

### AC-15: Complete remove preserves accounting rows (FR-17, FR-18)

Given complete remove is performed.
When the transaction completes.
Then no `CommissionEvent` or `CommissionSplit` rows are deleted or marked voided by that action.

## API Contracts

### GET /api/company/performance

Query:

```ts
type CompanyPerformanceRange = "today" | "thisWeek" | "thisMonth";

interface CompanyPerformanceQuery {
  range: CompanyPerformanceRange;
}
```

Regular affiliate response:

```ts
interface CompanyPerformanceResponse {
  range: CompanyPerformanceRange;
  timezone: "America/Toronto";
  timezoneLabel: string;
  window: {
    startIso: string;
    endIso: string;
    label: string;
  };
  totals: {
    conversions: number;
    visibleLeaderboardConversions: number;
  };
  leaderboard: Array<{
    rank: number;
    affiliateKey: string;
    displayName: string;
    conversions: number;
  }>;
  fetchedAt: string;
  stale: boolean;
}
```

Admin response MAY include extra fields:

```ts
interface AdminCompanyPerformanceResponse extends CompanyPerformanceResponse {
  adminTotals?: {
    grossAmountByCurrency?: Record<string, number>;
    payoutAmountByCurrency?: Record<string, number>;
  };
  hiddenRows?: Array<{
    affiliateKey: string;
    displayName: string;
    email: string | null;
    conversions: number;
  }>;
}
```

### GET /api/admin/leaderboard-affiliates

```ts
interface LeaderboardAffiliateAdminRow {
  affiliateKey: string;
  portalUserId: string | null;
  displayName: string;
  email: string | null;
  visibleOnLeaderboard: boolean;
  lastSyncedAt: string | null;
}
```

### PATCH /api/admin/leaderboard-affiliates/:affiliateKey

```ts
interface UpdateLeaderboardAffiliateRequest {
  visibleOnLeaderboard?: boolean;
  displayNameOverride?: string | null;
}
```

### DELETE /api/admin/teacher-student/:id

Existing safe archive remains supported.

```ts
interface ArchiveRelationshipRequest {
  archiveReason?: string;
  showInPreviousStudents?: boolean;
}
```

### POST /api/admin/teacher-student/:id/complete-remove

```ts
interface CompleteRemoveRelationshipRequest {
  reason?: string;
  confirm: true;
}

interface CompleteRemoveRelationshipResponse {
  ok: true;
  relationshipId: string;
  hiddenArchiveId: string;
  preservedIndirectRelationships: number;
}
```

## Data Models

The implementation SHOULD add a lightweight visibility table for leaderboard controls:

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | Primary key |
| affiliateKey | string | Unique stable affiliate-system id or portal fallback |
| portalUserId | string or null | Optional relation to User |
| email | string or null | Admin-only display, never regular leaderboard output |
| displayName | string or null | Non-sensitive display source |
| displayNameOverride | string or null | Admin override |
| visibleOnLeaderboard | boolean | Defaults true |
| lastSyncedAt | Date or null | Updated during refresh |
| createdAt | Date | Required |
| updatedAt | Date | Required |

```ts
interface LeaderboardAffiliateVisibility {
  id: string;
  affiliateKey: string; // External affiliate id or stable portal fallback.
  portalUserId: string | null;
  email: string | null;
  displayName: string | null;
  displayNameOverride: string | null;
  visibleOnLeaderboard: boolean;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

The implementation SHOULD add a cache table for company performance snapshots:

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | Primary key |
| range | enum | `today`, `thisWeek`, or `thisMonth` |
| timezone | string | Always `America/Toronto` |
| windowStart | Date | Required |
| windowEnd | Date | Required |
| payload | Json | Snapshot response payload |
| fetchedAt | Date | Required |
| staleAfter | Date | Required |
| createdAt | Date | Required |
| updatedAt | Date | Required |

```ts
interface CompanyPerformanceCache {
  id: string;
  range: "today" | "thisWeek" | "thisMonth";
  timezone: "America/Toronto";
  windowStart: Date;
  windowEnd: Date;
  payload: Json;
  fetchedAt: Date;
  staleAfter: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

Complete remove SHOULD reuse `TeacherStudentArchive` with `showInPreviousStudents=false` and an admin-only reason, plus a new explicit removal mode if needed to distinguish safe hidden archive from complete removal in admin audit views.

## Data Flow

1. A server-side refresh job fetches all affiliates from the affiliate system.
2. For each affiliate, the refresh fetches conversion/commission records and filters them into Toronto-time windows.
3. The refresh upserts leaderboard visibility metadata and writes range snapshots to `CompanyPerformanceCache`.
4. Regular dashboard requests read the latest snapshot and remove hidden leaderboard rows from the displayed ranking.
5. Admin visibility changes update `LeaderboardAffiliateVisibility` and invalidate or recompute the affected leaderboard view.
6. Personal dashboard stats continue to use local `CommissionSplit` data for the authenticated user.
7. Complete remove uses a transaction to deactivate the direct relationship, create a hidden archive/audit record, and skip depth-2 cascade behavior.

## UI Design

### Dashboard

Add a compact "Company Performance" section below personal stats and above recent commissions.

Controls:

- Segmented range control: Today, This Week, This Month.
- Toronto-time label under the selected range.
- Total conversions for the selected range.
- Top Affiliates leaderboard with rank, display name, and conversions.

Regular affiliates do not see company-wide money fields.

### Commissions Page

Add a small conversion summary near the page header:

- This month conversions
- Previous month conversions
- Selected time basis: Toronto time

### Admin Controls

Add an admin leaderboard visibility surface, likely under the admin area:

- Search/list affiliates.
- Toggle visibility on leaderboards.
- Optional display-name override.
- Hidden affiliates remain included in company totals.

Add a separate "Complete Remove" action in the managed affiliate student controls. It must be visually distinct from the current "Remove" archive action and include a confirmation dialog explaining that it hides the direct relationship from teacher calculations while preserving records.

## Edge Cases

- EC-1: External API unavailable: serve stale company performance cache if available.

- EC-2: Affiliate has no display name: use a privacy-safe fallback such as "Affiliate ####" for regular users; admins may see email.

- EC-3: Affiliate is hidden: include their conversions in totals but not leaderboard rows.

- EC-4: Same conversion appears more than once from upstream pagination or retries: de-duplicate by stable commission/conversion id.

- EC-5: Affiliate exists upstream but also has a portal user: prefer portal user display name unless admin override is set.

- EC-6: Complete remove is attempted on non-active relationship: return 409.

- EC-7: Complete remove is attempted on a depth-2 relationship: reject initially or require a separate explicit flow. This spec covers direct depth-1 removal.

- EC-8: Complete remove on `A -> B` while `A -> C` depth-2 exists: preserve `A -> C` and surface it as an indirect/orphan linked student if no direct parent remains.

- EC-9: Existing hidden archive records from the current archive flow: do not retroactively reinterpret them as complete removals unless the new removal mode is added and explicitly set.

## Out of Scope

- OS-1: Do not build hard deletion of users, commission events, commission splits, attendance, promo-code requests, or notifications.

- OS-2: Do not show full conversion amounts or company-wide money to regular affiliates.

- OS-3: Do not rename user-facing "conversions" to any external provider terminology.

- OS-4: Do not change payout reconciliation, paid/voided sync, or commission calculation rules except where complete remove prevents future direct teacher earnings.

- OS-5: Do not add real-time websockets for leaderboard updates in this phase.

## Testing Plan

- Unit test Toronto-time window helpers for today, week, and month boundaries.
- Unit test leaderboard row filtering so hidden affiliates remain in totals but not public rows.
- Unit test privacy mapping so regular leaderboard rows never include email.
- API test regular `/api/company/performance` response shape excludes admin-only money fields.
- API test admin visibility toggle updates leaderboard visibility.
- Relationship service test complete remove deactivates direct relationship without deactivating preserved depth-2 rows.
- Relationship service test complete remove does not delete or void commission splits.
- UI smoke test dashboard range switching and Toronto-time label.
- UI smoke test admin can hide/show leaderboard affiliates.

## Spec Self-Review

- No placeholders remain.
- The company-wide stats and complete removal scopes are separated.
- The design preserves the user requirement that `A -> C` remains active after complete-removing `A -> B`.
- The design avoids showing company-wide money to regular affiliates.
- The design keeps accounting records intact and avoids voiding historical commissions.
