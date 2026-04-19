# Admin Testing Cheat Sheet

Quick reference for onboarding test affiliates, syncing state, and
resetting between test cycles. All commands run from the admin browser's
DevTools console (you must be logged in as admin).

## 🟢 Full test cycle (new affiliate)

### 1. User signs in (prerequisite)
Test user signs in with their Google account at the portal. This
creates their `User` row and auto-links to Rewardful via NextAuth.
They'll see a "rate not set" banner — this is expected.

### 2. Admin runs test-setup (from YOUR admin console)
```js
fetch("/api/admin/test-setup", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({
    email: "TEST_USER_EMAIL@gmail.com",
    initialRate: 50,
    recurringRate: 20,
    runBackfill: true,
    runSyncPaid: true,
    submitAttendanceDays: 7
  })
}).then(r => r.json()).then(console.log)
```

Email is case-insensitive. Returns summary with split counts:
```json
{
  "ok": true,
  "splits": { "EARNED": 9, "PAID": 7 },
  "steps": { ... }
}
```

### 3. Test user refreshes their dashboard
Numbers should now appear at the configured rates.

---

## 🔄 Reset a test affiliate (for repeat cycles)

Wipes their commission history but keeps the User row + Rewardful link
intact. Run before test-setup to get a clean slate.

```js
fetch("/api/admin/test-setup?email=TEST_USER_EMAIL@gmail.com", {
  method: "DELETE"
}).then(r => r.json()).then(console.log)
```

Returns:
```json
{
  "ok": true,
  "deleted": {
    "events": 16,
    "splitsCascaded": 16,
    "attendance": 7,
    "rateAudit": 3
  }
}
```

Safety: refuses to wipe your own admin account.

---

## 🔁 Reset + re-onboard in one pass (testing loop)

```js
// One-liner for rapid iteration
(async () => {
  const email = "TEST_USER_EMAIL@gmail.com";
  await fetch(`/api/admin/test-setup?email=${email}`, {method:"DELETE"});
  const r = await fetch("/api/admin/test-setup", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      email,
      initialRate: 50,
      recurringRate: 20,
      runBackfill: true,
      runSyncPaid: true,
      submitAttendanceDays: 7
    })
  });
  console.log(await r.json());
})();
```

---

## 🪙 Sync paid state for ONE affiliate (UI)

Admin → Affiliates → click affiliate → "Sync paid state from Rewardful"
button at bottom of the left card.

Or via console:
```js
// Replace with the affiliate's User.id (not Rewardful ID)
fetch("/api/admin/affiliates/USER_ID_UUID/sync-paid", { method: "POST" })
  .then(r => r.json()).then(console.log)
```

---

## 🧰 Supabase query: find a user by email

When you need the user's `User.id` or other fields, from Supabase SQL
editor or via the postgres MCP:

```sql
SELECT id, email, "rewardfulAffiliateId",
       "initialCommissionPercent", "recurringCommissionPercent",
       "backfillStatus", "createdAt"
FROM "User"
WHERE email = 'test_user_email@gmail.com';
```

## 🧰 Supabase query: commission split distribution

Verify per-status counts + sums match Rewardful:

```sql
SELECT cs.status, cs."cutPercent", ce."isRecurring", ce.currency,
       COUNT(*) AS n, ROUND(SUM(cs."cutAmount"), 2) AS sum_native
FROM "CommissionSplit" cs
JOIN "CommissionEvent" ce ON ce.id = cs."eventId"
JOIN "User" u ON u.id = cs."recipientId"
WHERE u.email = 'test_user_email@gmail.com' AND cs.role = 'AFFILIATE'
GROUP BY cs.status, cs."cutPercent", ce."isRecurring", ce.currency
ORDER BY cs.status, ce."isRecurring";
```

## 🧰 Supabase query: rate change audit log

Timeline of rate changes for an affiliate:

```sql
SELECT ra.field, ra."previousPercent", ra."newPercent", ra."createdAt", ra.reason
FROM "CommissionRateAudit" ra
JOIN "User" u ON u.id = ra."affiliateId"
WHERE u.email = 'test_user_email@gmail.com'
ORDER BY ra."createdAt";
```

---

## 🔒 Production flow (no commands needed)

For real affiliates — no manual commands. The system handles:

1. **Affiliate signs up** — User + Rewardful link auto-created by OAuth
2. **Affiliate sees "waiting for admin" banner** — backfill does NOT
   auto-kick (rates are 0)
3. **Admin sets rates via admin panel** — when rates flip 0→positive,
   backfill auto-schedules via `after()`
4. **Nightly `/api/cron/reconcile` cron** handles sync-paid + classification
   repair automatically
5. **Admin has manual Sync Paid button per affiliate** for debugging

---

## 🔐 Auth notes

- All `/api/admin/*` endpoints require `session.user.isAdmin === true`
- Admin status is determined by `ADMIN_EMAIL` env var matching session email
- These endpoints fail closed with 403 if you're signed in as a non-admin
