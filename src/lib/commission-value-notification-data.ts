import Decimal from "decimal.js";

import { isCommissionVisibleToAffiliate } from "./commission-visibility.ts";

type DecimalInput = Decimal.Value | { toString(): string };

export interface CommissionValueNotificationEvent {
  id: string;
  rewardfulCommissionId: string | null;
  isRecurring: boolean;
  conversionDate: Date | string;
  currency: string;
}

export interface CommissionValueNotificationSplit {
  id: string;
  recipientId: string;
  role: "AFFILIATE" | "TEACHER";
  cutPercent: DecimalInput;
  cutAmount: DecimalInput;
  providerCutCad?: DecimalInput | null;
  status: "EARNED" | "FORFEITED" | "PENDING" | "PAID" | "VOIDED";
  recipient: {
    id: string;
    status: "ACTIVE" | "DEACTIVATED" | "REJECTED";
    canSeeRecurringCommissions: boolean;
    recurringCommissionsVisibleFrom?: Date | string | null;
  };
}

export interface CommissionValueNotificationInput {
  event: CommissionValueNotificationEvent;
  splits: CommissionValueNotificationSplit[];
}

export interface CommissionValueNotification {
  userId: string;
  dedupeKey: string;
  type: "CONVERSION_RECEIVED";
  title: string;
  body: string;
  data: {
    commissionId: string;
    commissionSplitId: string;
    isRecurring: boolean;
    role: "AFFILIATE" | "TEACHER";
    href: "/commissions";
  };
}

export interface CommissionValueNotificationCopy {
  title: string;
  body: string;
}

export function buildCommissionValueNotifications({
  event,
  splits,
}: CommissionValueNotificationInput): CommissionValueNotification[] {
  const commissionKey = event.rewardfulCommissionId ?? event.id;

  return splits
    .filter((split) => shouldNotifySplit(event, split))
    .flatMap((split) => {
      const copy = getCommissionValueNotificationCopy(event, split);
      if (!copy) return [];

      return {
        userId: split.recipientId,
        dedupeKey: `commission-value:${commissionKey}:${split.recipientId}`,
        type: "CONVERSION_RECEIVED",
        title: copy.title,
        body: copy.body,
        data: {
          commissionId: event.id,
          commissionSplitId: split.id,
          isRecurring: event.isRecurring,
          role: split.role,
          href: "/commissions",
        },
      };
    });
}

export function getCommissionValueNotificationCopy(
  event: CommissionValueNotificationEvent,
  split: CommissionValueNotificationSplit
): CommissionValueNotificationCopy | null {
  const display = getDisplayMoney(event, split);
  if (!display) return null;

  const title = event.isRecurring
    ? "Recurring Commission Recorded"
    : "Commission Recorded";
  const commissionLabel = event.isRecurring
    ? "a recurring commission"
    : "a new commission";

  return {
    title,
    body: `You earned ${formatMoney(
      display.amount,
      display.currency
    )} on ${commissionLabel}.`,
  };
}

function shouldNotifySplit(
  event: CommissionValueNotificationEvent,
  split: CommissionValueNotificationSplit
): boolean {
  if (split.recipient.status !== "ACTIVE") return false;
  if (split.status !== "EARNED" && split.status !== "PAID") return false;
  if (
    !isCommissionVisibleToAffiliate(
      {
        isRecurring: event.isRecurring,
        conversionDate: event.conversionDate,
      },
      split.recipient
    )
  ) {
    return false;
  }

  const display = getDisplayMoney(event, split);

  return display !== null && display.amount.gt(0);
}

function getDisplayMoney(
  event: CommissionValueNotificationEvent,
  split: CommissionValueNotificationSplit
): { amount: Decimal; currency: string } | null {
  if (split.providerCutCad !== undefined && split.providerCutCad !== null) {
    return { amount: toDecimal(split.providerCutCad), currency: "CAD" };
  }

  const eventCurrency = event.currency.toUpperCase();
  if (eventCurrency === "CAD") {
    return { amount: toDecimal(split.cutAmount), currency: "CAD" };
  }

  return null;
}

function formatMoney(amount: Decimal, currency: string): string {
  const normalizedCurrency = currency.toUpperCase();
  const sign = amount.isNegative() ? "-" : "";
  const numeric = new Intl.NumberFormat("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount.abs().toNumber());

  if (normalizedCurrency === "CAD") {
    return `${sign}CA$${numeric}`;
  }

  if (normalizedCurrency === "USD") {
    return `${sign}US$${numeric}`;
  }

  return `${sign}${normalizedCurrency} ${numeric}`;
}

function toDecimal(value: DecimalInput): Decimal {
  return new Decimal(value.toString());
}
