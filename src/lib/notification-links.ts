import type { NotificationType } from "@prisma/client";

const DEFAULT_NOTIFICATION_HREFS: Partial<Record<NotificationType, string>> = {
  CONVERSION_RECEIVED: "/commissions",
  ATTENDANCE_FORFEITURE_ALERT: "/attendance",
  PROMO_CODE_REQUEST_RECEIVED: "/promo-codes",
  PROMO_CODE_APPROVED: "/promo-codes",
  PROMO_CODE_REJECTED: "/promo-codes",
  COMMISSION_RATE_CHANGED: "/commissions",
  NEW_STUDENT_LINKED: "/students",
  AFFILIATE_DEACTIVATED: "/settings",
  AFFILIATE_AUTO_CREATED: "/admin",
  RATE_PROPOSAL_SUBMITTED: "/admin/proposals",
  RATE_PROPOSAL_APPROVED: "/proposals",
  RATE_PROPOSAL_REJECTED: "/proposals",
  STUDENT_PROPOSAL_RECEIVED: "/admin/proposals",
  STUDENT_PROPOSAL_APPROVED: "/students",
  STUDENT_PROPOSAL_REJECTED: "/students",
  STUDENT_PAYMENT_RECEIVED: "/students",
  COMMISSION_VOIDED: "/commissions",
  FIRST_ATTENDANCE_RECORDED: "/attendance",
};

export function resolveNotificationHref(
  type: NotificationType | string,
  data?: { href?: unknown } | null
): string {
  const explicitHref =
    typeof data?.href === "string" && data.href.startsWith("/")
      ? data.href
      : null;

  if (explicitHref) {
    return explicitHref;
  }

  return (
    DEFAULT_NOTIFICATION_HREFS[type as NotificationType] ?? "/notifications"
  );
}
