# TradersUtopia Affiliate Commission Portal — Development Notes

## Non-Negotiable Rules

### Rewardful Opacity Rule
**CRITICAL**: The name "Rewardful" must NEVER appear anywhere in the frontend or user-facing UI. This includes labels, tooltips, error messages, loading states, notifications, dashboard text, success messages, and any text a user can read.

- Rewardful is backend/internal integration only
- All data sourced from Rewardful must be presented as our own system
- No reference to any third party

### Admin Control Rule
- Admin can adjust any affiliate's commission percentage at any time
- Changes take effect on NEXT conversion (not retroactive)
- Admin UI shows: previous%, current%, what's actively applied
- History shows only one step back (previous vs current)
- Full audit log stored in database for record-keeping

## Project Context

**Tech Stack:**
- Frontend/Backend: Next.js (React)
- Database: PostgreSQL
- Auth: NextAuth.js (Google OAuth + email/password)
- Notifications: Firebase Cloud Messaging (FCM)
- Currency: Live exchange rates, displayed to 2 decimals
- Deployment: Vercel + Railway/Supabase

**Scale:** 50-100 affiliates now, up to few hundred long-term

**Rewardful Integration:**
- Webhook listener for conversion events
- API calls for promo code creation
- Environment variables already present in `.env`

## Architecture Pillars

### 1. Teacher/Student Hierarchy
- Max depth: 2 levels (Teacher → Student → Student's Student)
- Person can be both student AND teacher simultaneously
- A student can have MULTIPLE teachers
- If percentages don't "fit", prompt user with conflict dialog
- Teacher earns from direct students AND students' students (2 levels only)

### 2. Commission / Profit Sharing
- Full conversion amount never shown to affiliates—only their cut
- Split example: Affiliate 40%, Teacher 10%, Teacher's Teacher 10%, CEO remainder
- CEO gets whatever's left after all cuts
- Teachers get their cut regardless of student attendance
- **Forfeiture rule:** If student had NO attendance for conversion day:
  - Student's cut is forfeited (goes to CEO, not student)
  - Teachers still get their normal cuts
  - Commission shown in history, marked as "forfeited/missed"

### 3. Attendance System
- Affiliates submit attendance to indicate marketing activity
- Multiple submissions per day allowed
- Required to receive commission payout
- Admin can view all who missed attendance but had conversion

### 4. Promo Code Request Flow
1. Affiliate requests code (4-6 letters only) inside app
2. Teacher gets persistent push notification
3. Teacher approves/rejects in app
4. On approval → auto-send to Rewardful API
5. No manual step required

### 5. Payout History Display
- Each commission entry individually listed
- Shows ONLY affiliate's cut (never full amount)
- Date format: Day name, Month name, Time in AM/PM
- Timezone: auto-detected from browser/location
- Forfeited commissions clearly labeled as missed/forfeited
- CAD/USD toggle—live exchange rates pulled dynamically, 2 decimals

### 6. Teacher Dashboard
- Teachers view all students AND students' students
- Teachers see same data as their students (commissions, signups, attendance)
- Clean, simple interface

### 7. Admin-Only Features
- Deactivate/remove affiliates
- Before removal, show full subtree beneath affiliate
- Option to reassign each person in subtree or leave unassigned
- No automatic reassignment
- Full control over affiliate-visible values

## Notifications (Firebase Cloud Messaging)

PWA installable on iOS/Android home screens. Push notifications for:
- New conversion received
- Attendance not submitted when conversion came in (forfeiture alert)
- Promo code request received (teacher)
- Promo code approved/rejected (student)
- Commission percentage changed (affiliate)
- New student linked under teacher
- Affiliate deactivated

Notifications must be descriptive and actionable, not generic.

## User Roles

### Regular Affiliate (Marketer)
- Signs up via Google OAuth or email/password
- Can be student, teacher, or both
- Sees only their own data

### Admin
- One hardcoded admin email
- Logs in same way (Google or email/password)
- Admin status invisible to regular users
- Has all regular views PLUS admin-only controls
- Admin existence not disclosed in UI

## References
- Rewardful API docs: via `/rewardful` MCP server
- Project instructions: `INSTRUTCIONS.txt`
- Rewardful MCP: `mcp/rewardful-server.mjs`
