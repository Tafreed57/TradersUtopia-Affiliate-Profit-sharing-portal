export type PortalAccountType = "COMMISSION" | "WORK";

export interface PortalIdentity {
  accountType?: string | null;
  isAdmin?: boolean;
}

export function isWorkPortalUser(user: PortalIdentity | null | undefined): boolean {
  return user?.accountType === "WORK" && !user.isAdmin;
}

/** Account eligibility is independent of admin access and configured rates. */
export function isCommissionEligible(user: Pick<PortalIdentity, "accountType">): boolean {
  return user.accountType !== "WORK";
}

const WORK_PAGES = new Set(["/attendance", "/promo-codes", "/settings", "/notifications"]);
const WORK_API_METHODS: Record<string, readonly string[]> = {
  "/api/attendance": ["GET", "POST"],
  "/api/promo-codes": ["GET", "POST"],
  "/api/settings/profile": ["GET"],
  "/api/notifications": ["GET", "PATCH"],
  "/api/notifications/register-token": ["POST"],
};

export function canAccessWorkRoute(pathname: string, method = "GET"): boolean {
  if (pathname.startsWith("/api/")) {
    return WORK_API_METHODS[pathname]?.includes(method.toUpperCase()) ?? false;
  }
  return WORK_PAGES.has(pathname);
}

export function portalHome(user: PortalIdentity): string {
  return isWorkPortalUser(user) ? "/attendance" : "/";
}

/** Only same-origin application paths may be restored after authentication. */
export function safePortalDestination(value: string | null | undefined, user: PortalIdentity): string {
  const fallback = portalHome(user);
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  let parsed: URL;
  try { parsed = new URL(value, "https://portal.invalid"); } catch { return fallback; }
  if (parsed.origin !== "https://portal.invalid") return fallback;
  if (/^\/(api|auth|login|register|work)(\/|$)/.test(parsed.pathname)) return fallback;
  if (isWorkPortalUser(user) && !canAccessWorkRoute(parsed.pathname)) return fallback;
  return parsed.pathname + parsed.search + parsed.hash;
}
