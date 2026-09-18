# Lead Alerts, Provider-Matched Commissions, and Test Cleanup Design

## Metadata

- Author: Codex
- Date: 2026-06-17
- Status: Approved for implementation
- Reviewer: Tafreed

## Context

Conversion notifications currently wait for the commission webhook, even though the earlier `referral.lead` webhook is the first reliable signal that the portal should present as a conversion. The later webhook also contains money and currently creates a second, amount-bearing alert.

CAD commission values are currently derived from native event amounts using today's CAD/USD rate. That causes historical `Due now`, `In holding`, `Paid`, dashboard, and teacher/student figures to drift from the affiliate system. Production diagnosis confirmed that Linda's value for Mario is an exchange-rate discrepancy, not a voiding discrepancy. Voided events already void every affiliate and teacher split and are excluded from payable totals.

Twenty-four generated Playwright users were left in production. They were identified by the exact names `Dashboard Test User`, `Test User`, and `Login Test User`, `@example.com` addresses, no upstream affiliate id, and zero business dependencies.

All user-facing copy must follow the provider-opacity rule. The external provider name remains internal only.

## Functional Requirements

1. Treat `referral.lead` as the notification-stage conversion signal.
2. Send one generic `CONVERSION_RECEIVED` notification to the affiliate and every active direct/indirect teacher that would receive the later conversion alert.
3. Do not include money in lead-stage notifications because commission amounts do not exist yet.
4. Deduplicate each recipient's lead alert by referral id so webhook retries cannot create or push a second alert.
5. Never create another conversion alert when the commission webhook arrives.
6. Continue creating commission events and splits from commission webhooks exactly as before.
7. Continue excluding voided splits from affiliate and teacher payable totals.
8. Anchor CAD values to the affiliate system's own CAD totals for each state: paid, due, and pending (`unpaid - due`).
9. Apportion each state total to local events without today's exchange rate:
   - CAD events keep their native CAD value.
   - The CAD remainder is divided across USD events by their exact full amounts, producing a state-specific implied historical conversion factor.
   - A recipient's CAD amount is the event's allocated CAD full amount multiplied by the split's exact `cutPercent`.
10. Use exact decimal arithmetic and round only display/output values to cents. Do not sum already-rounded `cutAmount` rows when calculating CAD totals.
11. Keep native event amounts for the USD view. CAD views use the provider-anchored allocation.
12. Apply the allocator to affiliate lifetime totals, dashboard totals, admin totals, teacher/student totals, relationship snapshots, and individual commission rows that offer CAD display.
13. Cache the upstream state totals for five minutes and serve the last successful values as stale during an upstream outage. Do not fall back to today's exchange rate for commission accounting.
14. Hard-delete only the 24 identified generated users after asserting they have no protected dependencies.
15. Ensure Playwright-created registration users are deleted in test teardown, including after test failure.

## CAD Allocation Model

For one affiliate and one state:

```text
upstreamCad = affiliate-system CAD state total
nativeCad = sum(fullAmount for local CAD events in state)
nativeUsd = sum(fullAmount for local USD events in state)

usdToCad = max(upstreamCad - nativeCad, 0) / nativeUsd
eventCad = event.currency == CAD ? event.fullAmount : event.fullAmount * usdToCad
splitCad = eventCad * split.cutPercent / 100
```

If the local event set is temporarily incomplete or the CAD remainder is invalid, allocation is marked stale/unavailable and the last successful cached state allocation is preferred. No live-rate fallback is permitted for due, pending, paid, or earned commission accounting.

For Linda's due events, the upstream CAD due base is CA$8,886.40. Mario's exact 20% share is therefore CA$1,777.28. Four voided events remain excluded.

## Notification Data Flow

1. Webhook signature and payload parsing remain unchanged.
2. `referral.lead` is parsed into referral id and upstream affiliate id.
3. The local affiliate and active two-level teacher chain are resolved.
4. Each recipient receives a generic conversion notification with a deterministic key `lead-conversion:<referralId>:<userId>`.
5. A unique database constraint makes retries safe under concurrency.
6. The later commission webhook creates accounting rows but no notification.

## Data Changes

Add nullable `Notification.dedupeKey` with a unique constraint. Existing notifications remain valid because PostgreSQL permits multiple null values in a unique index.

No commission schema change is required. Provider CAD state totals are cached inside the existing `User.lifetimeStatsJson` document with their own cache timestamp so teacher refreshes do not incorrectly mark an incomplete lifetime payload as fresh.

## Test-Account Cleanup

The production deletion is restricted to the pre-inspected 24 user ids. The transaction aborts unless:

- exactly 24 records match the identified names and domain;
- every record has no upstream affiliate id; and
- there are no commission events/splits, rate audits, proposals, promo requests, restore reviews, or archive actions referencing those ids.

The cleanup has been executed successfully and a verification query returned zero remaining matches.

## Acceptance Criteria

- A `referral.lead` delivery creates one conversion alert per eligible affiliate/teacher recipient.
- Re-delivering the same lead creates zero additional notification rows and zero additional pushes.
- A later commission webhook creates splits and no conversion alert.
- Notification text contains no amount and no external provider name.
- Voiding any event removes both affiliate and teacher splits from payable totals.
- Linda's Mario due value resolves to CA$1,777.28 with the current production data snapshot.
- CAD totals across all core affiliate/admin/teacher surfaces use the state allocator, not `getCadToUsdRate()`.
- Native USD commission values remain available in USD mode.
- All 24 identified production test accounts are absent.
- E2E registration tests clean up every generated account.

## Out of Scope

- The NURSE promo-code failure is a separate follow-up and begins only after this work passes verification.
- No retroactive notification is sent for leads that occurred before deployment.
- No user-facing mention of the external affiliate provider is added.
- No change is made to commission percentages or voiding rules.

## Self-Review

- The design covers affiliate and teacher alerts and explicitly prevents the later duplicate.
- The expected Linda/Mario amount distinguishes proportional state allocation from distribution of the whole state total among recipients.
- Voided rows are excluded rather than re-priced.
- Production deletion is bounded to the inspected generated records.
- The promo-code bug is deliberately isolated from this implementation.
