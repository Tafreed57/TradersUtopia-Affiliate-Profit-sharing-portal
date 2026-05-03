import type { NotificationType } from "@prisma/client";

const TEACHER_EARNINGS_BODY =
  /^(.+?)\s+is\s+now\s+earning\s+a\s+cut\s+from\s+your\s+commissions\.?$/i;

export function sanitizeNotificationCopy(
  type: NotificationType | string,
  title: string,
  body: string
): { title: string; body: string } {
  const teacherEarningsMatch = body.match(TEACHER_EARNINGS_BODY);
  if (type === "NEW_STUDENT_LINKED" && teacherEarningsMatch) {
    const teacherLabel = teacherEarningsMatch[1]?.trim();
    return {
      title: "Teacher link updated",
      body: teacherLabel
        ? `${teacherLabel} is now listed as one of your teachers.`
        : "Your teacher list has been updated.",
    };
  }

  return { title, body };
}
