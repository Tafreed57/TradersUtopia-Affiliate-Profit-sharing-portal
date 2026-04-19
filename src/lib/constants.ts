export const APP_NAME = "TradersUtopia Affiliate Portal";
export const APP_SHORT_NAME = "TU Portal";
export const APP_DESCRIPTION = "Track your affiliate commissions and marketing activity";

// Admin allowlist. `ADMIN_EMAIL` env var accepts a single email OR a
// comma-separated list for multiple admins. All whitespace trimmed,
// all compares lowercase. Empty strings are discarded so trailing
// commas don't accidentally grant access.
export const ADMIN_EMAILS: string[] = (process.env.ADMIN_EMAIL ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter((e) => e.length > 0);

/**
 * Primary admin email — used by flows that need a single identity to
 * "notify the admin" (e.g. new proposal inbox). This is the first
 * entry in the ADMIN_EMAIL env var. Additional admins still get full
 * `isAdmin: true` on their session, they just don't receive these
 * specific notifications individually.
 */
export const ADMIN_EMAIL: string = ADMIN_EMAILS[0] ?? "";

/** True if the given email matches any entry in the admin allowlist. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Prisma `where` predicate that matches any User whose email is in the
 * admin allowlist, case-insensitively. Postgres string comparison is
 * case-sensitive by default and Prisma `in` doesn't accept a mode arg,
 * so we emit one `equals` per admin email with `mode: "insensitive"`.
 * Use for lookups that need to notify admins regardless of how their
 * email is stored in the DB.
 */
export function adminUserWhereOr(): {
  OR: Array<{ email: { equals: string; mode: "insensitive" } }>;
} | null {
  if (ADMIN_EMAILS.length === 0) return null;
  return {
    OR: ADMIN_EMAILS.map((e) => ({
      email: { equals: e, mode: "insensitive" as const },
    })),
  };
}

export const TEACHER_CUT_WARN_THRESHOLD = Number(
  process.env.TEACHER_CUT_WARN_THRESHOLD ?? "85"
);

export const PROMO_CODE_MIN_LENGTH = 4;
export const PROMO_CODE_MAX_LENGTH = 6;

export const CURRENCY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const MAX_TEACHER_DEPTH = 2;
