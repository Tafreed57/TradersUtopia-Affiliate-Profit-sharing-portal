import type { NotificationType } from "@prisma/client";

/** Allowlist: new notification types stay hidden from Work accounts by default. */
export const WORK_NOTIFICATION_TYPES: NotificationType[] = [
  "FIRST_ATTENDANCE_RECORDED",
  "PROMO_CODE_APPROVED",
  "PROMO_CODE_REJECTED",
  "AFFILIATE_DEACTIVATED",
  "TEST_NOTIFICATION",
];

export function isWorkNotificationAllowed(type: string): boolean {
  return WORK_NOTIFICATION_TYPES.includes(type as NotificationType);
}

/** Work notices never inherit financial metadata or destinations from old rows. */
export function workNotificationPresentation(type: string) {
  switch (type) {
    case "FIRST_ATTENDANCE_RECORDED":
      return { title: "Attendance started", body: "Your first attendance is recorded. Keep marking attendance on days you go live.", data: { href: "/attendance" } };
    case "PROMO_CODE_APPROVED":
      return { title: "Promo code ready", body: "Your promo code is active. Open Promo Codes to view and share it.", data: { href: "/promo-codes" } };
    case "PROMO_CODE_REJECTED":
      return { title: "Promo code needs attention", body: "Your promo code could not be approved. Open Promo Codes to review it and try again.", data: { href: "/promo-codes" } };
    case "AFFILIATE_DEACTIVATED":
      return { title: "Account deactivated", body: "Your account has been deactivated. Contact support for more information.", data: { href: "/settings" } };
    default:
      return { title: "Account notification", body: "You have a new account notification.", data: { href: "/notifications" } };
  }
}
