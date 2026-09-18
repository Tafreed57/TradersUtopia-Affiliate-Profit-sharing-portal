# Company Performance and Complete Removal Implementation Plan

## Goal
Add company-wide conversion performance visibility, affiliate leaderboard controls, monthly conversion summaries, paid-this-month reporting, and a safe admin-only complete removal action for teacher-student links.

## Guardrails
- Never show the backend vendor name in frontend text, API messages intended for users, loading states, or errors.
- Regular affiliates can see company conversion counts and leaderboard rankings, but not company-wide money or other affiliates' private email addresses.
- Admins can see and manage leaderboard visibility.
- Hidden leaderboard affiliates are excluded from ranking rows but still included in company totals.
- Complete removal is not a hard delete and does not void historical commissions.
- Complete removal only removes the selected direct teacher-student link and must preserve existing indirect links such as `A -> C` when removing `A -> B`.
- Reporting ranges use `America/Toronto` and UI copy must explicitly mention Toronto time.

## Steps
1. Add failing tests first.
   - Test Toronto business windows for today, week, month, and previous month.
   - Test company leaderboard shaping: hidden affiliates count in totals but not rows; public payload excludes money and email fields.
   - Test complete-removal planning preserves indirect relationship IDs.
2. Add Prisma data model changes.
   - Add leaderboard visibility records keyed by external affiliate id.
   - Add company performance cache records keyed by range.
   - Add archive mode metadata to distinguish safe archive from complete removal.
   - Create a hand-written migration SQL file.
3. Implement services.
   - Build Toronto date range helpers.
   - Build company performance aggregation/caching from backend affiliate data.
   - Build admin visibility update helpers.
   - Add complete-removal service function that deactivates only the selected depth-1 relationship and archives it with `showInPreviousStudents=false`.
4. Add API endpoints.
   - Public authenticated company performance endpoint.
   - Admin leaderboard visibility list/update endpoint.
   - Admin complete-removal endpoint.
   - Add `paidThisMonth` to dashboard stats.
   - Add monthly conversion counts to commissions data.
5. Update UI.
   - Main dashboard: show personal monthly commission, paid this month, company conversions, Toronto time label, and leaderboard with today/week/month range buttons.
   - Commissions page: show current and previous month conversion counts.
   - Admin page: add leaderboard visibility controls.
   - Managed affiliate workspace: add a visually distinct complete-remove dialog/action for direct student links.
6. Verify.
   - Run targeted unit tests after red and green phases.
   - Run full `npm run test:unit`.
   - Run `npm run lint` and `npx prisma generate`.
   - If feasible, run/build-check the touched Next routes.

