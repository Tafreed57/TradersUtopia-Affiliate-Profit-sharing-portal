import { Prisma } from "@prisma/client";

export interface RecurringCommissionVisibility {
  /**
   * Legacy DB/API name. In the current admin UX this means the recurring-row
   * hide rule is ON. When false, recurring commission history is not changed.
   */
  canSeeRecurringCommissions: boolean;
  recurringCommissionsVisibleFrom?: Date | string | null;
}

export interface CommissionVisibilityEvent {
  isRecurring: boolean;
  conversionDate: Date | string;
}

export type AffiliateCommissionVisibilityReason =
  | "first_time_commission"
  | "recurring_visible"
  | "recurring_visible_before_hide_from"
  | "recurring_hidden_all_history"
  | "recurring_hidden_after_hide_from";

export function isCommissionVisibleToAffiliate(
  event: CommissionVisibilityEvent,
  visibility: boolean | RecurringCommissionVisibility
) {
  const reason = getCommissionAffiliateVisibilityReason(event, visibility);
  return (
    reason === "first_time_commission" ||
    reason === "recurring_visible" ||
    reason === "recurring_visible_before_hide_from"
  );
}

export function getCommissionAffiliateVisibilityReason(
  event: CommissionVisibilityEvent,
  visibility: boolean | RecurringCommissionVisibility
): AffiliateCommissionVisibilityReason {
  const normalized = normalizeRecurringCommissionVisibility(visibility);

  if (!event.isRecurring) {
    return "first_time_commission";
  }

  if (!normalized.canSeeRecurringCommissions) {
    return "recurring_visible";
  }

  if (!normalized.recurringCommissionsVisibleFrom) {
    return "recurring_hidden_all_history";
  }

  const conversionDate = normalizeDate(event.conversionDate);
  const hideFrom = normalizeDate(normalized.recurringCommissionsVisibleFrom);

  return conversionDate >= hideFrom
    ? "recurring_hidden_after_hide_from"
    : "recurring_visible_before_hide_from";
}

/**
 * Applies the admin-controlled recurring commission hide rule to an
 * affiliate-facing CommissionSplit query.
 *
 * When the hide rule is off, the caller's query is returned unchanged. When
 * "all history" hiding is enabled, recurring rows disappear from affiliate
 * commission surfaces without changing the underlying accounting. When a
 * "from now onward" cutoff is present, older recurring rows remain visible and
 * only new recurring rows on/after the cutoff are hidden.
 */
export function applyRecurringCommissionVisibility(
  where: Prisma.CommissionSplitWhereInput,
  visibility: boolean | RecurringCommissionVisibility
): Prisma.CommissionSplitWhereInput {
  const normalized = normalizeRecurringCommissionVisibility(visibility);

  if (!normalized.canSeeRecurringCommissions) {
    return where;
  }

  if (!normalized.recurringCommissionsVisibleFrom) {
    return requireNonRecurringEvent(where);
  }

  const hideFrom = normalizeDate(normalized.recurringCommissionsVisibleFrom);

  return {
    AND: [
      where,
      {
        OR: [
          { event: { isRecurring: false } },
          {
            event: {
              isRecurring: true,
              conversionDate: { lt: hideFrom },
            },
          },
        ],
      },
    ],
  };
}

function normalizeRecurringCommissionVisibility(
  visibility: boolean | RecurringCommissionVisibility
): RecurringCommissionVisibility {
  return typeof visibility === "boolean"
    ? {
        canSeeRecurringCommissions: visibility,
        recurringCommissionsVisibleFrom: null,
      }
    : visibility;
}

function normalizeDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function requireNonRecurringEvent(
  where: Prisma.CommissionSplitWhereInput
): Prisma.CommissionSplitWhereInput {
  const existingEvent = where.event;
  if (!existingEvent) {
    return {
      ...where,
      event: { isRecurring: false },
    };
  }

  if (
    typeof existingEvent === "object" &&
    !Array.isArray(existingEvent) &&
    !("is" in existingEvent) &&
    !("isNot" in existingEvent)
  ) {
    const existingEventWhere =
      existingEvent as Prisma.CommissionEventWhereInput;
    return {
      ...where,
      event: {
        ...existingEventWhere,
        isRecurring: false,
      },
    };
  }

  return {
    AND: [where, { event: { isRecurring: false } }],
  };
}
