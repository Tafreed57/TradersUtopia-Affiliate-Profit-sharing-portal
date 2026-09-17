import type { NotificationType } from "@prisma/client";

const TEACHER_EARNINGS_BODY =
  /^(.+?)\s+is\s+now\s+earning\s+a\s+cut\s+from\s+your\s+commissions\.?$/i;

export function sanitizeNotificationCopy(
  type: NotificationType | string,
  title: string,
  body: string
): { title: string; body: string } {
  if (type === "CONVERSION_RECEIVED") {
    return sanitizeConversionNotificationCopy(title, body);
  }

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

function sanitizeConversionNotificationCopy(
  title: string,
  body: string
): { title: string; body: string } {
  const strippedTitle = stripKnownRatePhrases(title);
  const strippedBody = stripKnownRatePhrases(body);
  const titleHasDisclosure = hasPrivateRateDisclosure(strippedTitle);
  const bodyHasDisclosure = hasPrivateRateDisclosure(strippedBody);

  return {
    title: titleHasDisclosure
      ? isRecurringCommissionCopy(title, body)
        ? "Recurring Commission Recorded"
        : "Commission Recorded"
      : strippedTitle,
    body: bodyHasDisclosure
      ? buildSafeCommissionBody(title, body)
      : normalizeBareCommissionBody(strippedBody, title, body),
  };
}

function stripKnownRatePhrases(text: string): string {
  return text
    .replace(
      /\s+(?:at|with|using)\s+(?:an?\s+)?(?:your\s+)?\d+(?:\.\d+)?%\s*(?:commission\s*)?(?:rate|cut|percentage)?/gi,
      ""
    )
    .replace(
      /\s+based\s+on\s+(?:an?\s+)?(?:your\s+)?\d+(?:\.\d+)?%\s*(?:commission\s*)?(?:rate|cut|percentage)?/gi,
      ""
    )
    .replace(
      /\s+(?:at|with|using|based\s+on)\s+(?:your\s+)?(?:commission\s+)?(?:rate|percentage|percent)\b/gi,
      ""
    )
    .replace(
      /\s*\(\s*\d+(?:\.\d+)?%\s*(?:commission\s*)?(?:rate|cut|percentage)?\s*\)/gi,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function hasPrivateRateDisclosure(text: string): boolean {
  return /\b\d+(?:\.\d+)?\s*%/.test(text) || /\b(rate|percentage|percent)\b/i.test(text);
}

function buildSafeCommissionBody(title: string, body: string): string {
  const amount = extractMoneyAmount(body);
  if (!amount) {
    return "A new conversion was recorded.";
  }

  const commissionLabel = isRecurringCommissionCopy(title, body)
    ? "a recurring commission"
    : "a new commission";

  return `You earned ${amount} on ${commissionLabel}.`;
}

function isRecurringCommissionCopy(title: string, body: string): boolean {
  return /\brecurring\b/i.test(`${title} ${body}`);
}

function normalizeBareCommissionBody(
  body: string,
  title: string,
  originalBody: string
): string {
  const amount = extractMoneyAmount(body);
  if (!amount || body !== `You earned ${amount}.`) {
    return body;
  }

  const commissionLabel = isRecurringCommissionCopy(title, originalBody)
    ? "a recurring commission"
    : "a new commission";

  return `You earned ${amount} on ${commissionLabel}.`;
}

function extractMoneyAmount(text: string): string | null {
  return (
    text.match(/\b(?:CA\$|US\$|\$|CAD\s+|USD\s+)\s?\d[\d,]*(?:\.\d{2})?\b/i)?.[0] ??
    null
  );
}
