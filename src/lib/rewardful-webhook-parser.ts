import {
  normalizeRewardfulCommissionState,
  type RewardfulCommissionState,
} from "./rewardful.ts";

export interface ParsedWebhookConversion {
  rewardfulCommissionId: string;
  rewardfulReferralId?: string;
  affiliateRewardfulId: string;
  amount: number;
  currency?: string;
  conversionDate: string;
  upstreamState?: RewardfulCommissionState | null;
  upstreamDueAt?: string | null;
  upstreamPaidAt?: string | null;
  upstreamVoidedAt?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  rawPayload: Record<string, unknown>;
}

export function extractEventType(payload: Record<string, unknown>): string {
  const wrapper = payload.event;
  if (wrapper && typeof wrapper === "object") {
    const t = (wrapper as Record<string, unknown>).type;
    if (typeof t === "string") return t;
  }
  if (typeof wrapper === "string") return wrapper;
  if (typeof payload.type === "string") return payload.type;
  return "";
}

export function isCommissionConversionEvent(event: unknown): boolean {
  if (typeof event !== "string" || event.length === 0) return false;
  const conversionEvents = [
    "conversion.created",
    "commission.created",
    "referral.conversion",
  ];
  return conversionEvents.includes(event.toLowerCase());
}

export function extractCommissionObject(
  payload: Record<string, unknown>
): Record<string, unknown> {
  for (const candidate of [payload.object, payload.data, payload.commission]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return payload;
}

export function extractConversion(
  payload: Record<string, unknown>
): ParsedWebhookConversion | null {
  const data = extractCommissionObject(payload);

  const commissionId =
    getString(data, "id") ?? getString(payload, "commission_id");
  if (!commissionId) return null;

  const saleCandidate = data.sale;
  const saleObj =
    saleCandidate && typeof saleCandidate === "object" && !Array.isArray(saleCandidate)
      ? (saleCandidate as Record<string, unknown>)
      : {};

  const amountRaw =
    getNumber(saleObj, "sale_amount_cents") ??
    getNumber(saleObj, "charge_amount_cents") ??
    getNumber(data, "amount") ??
    getNumber(data, "sale_amount") ??
    getNumber(payload, "amount");
  if (amountRaw == null) return null;

  const amount = amountRaw / 100;
  const currency = (
    getString(saleObj, "currency") ??
    getString(data, "currency") ??
    getString(payload, "currency") ??
    "USD"
  ).toUpperCase();

  const affiliateId =
    getString(data, "affiliate_id") ??
    getString((data.affiliate as Record<string, unknown>) ?? {}, "id") ??
    getString((saleObj.affiliate as Record<string, unknown>) ?? {}, "id") ??
    getString(payload, "affiliate_id");
  if (!affiliateId) return null;

  const referralId =
    getString((saleObj.referral as Record<string, unknown>) ?? {}, "id") ??
    getString(data, "referral_id") ??
    getString((data.referral as Record<string, unknown>) ?? {}, "id");

  const dateStr =
    getString(saleObj, "charged_at") ??
    getString(saleObj, "invoiced_at") ??
    getString(data, "created_at") ??
    getString(data, "charged_at") ??
    getString(payload, "created_at") ??
    new Date().toISOString();

  return {
    rewardfulCommissionId: commissionId,
    rewardfulReferralId: referralId ?? undefined,
    affiliateRewardfulId: affiliateId,
    amount,
    currency,
    conversionDate: dateStr,
    upstreamState: normalizeRewardfulCommissionState(data.state),
    upstreamDueAt: getString(data, "due_at"),
    upstreamPaidAt: getString(data, "paid_at"),
    upstreamVoidedAt: getString(data, "voided_at"),
    campaignId: getString((data.campaign as Record<string, unknown>) ?? {}, "id"),
    campaignName: getString((data.campaign as Record<string, unknown>) ?? {}, "name"),
    rawPayload: payload,
  };
}

function getString(
  obj: Record<string, unknown>,
  key: string
): string | null {
  const val = obj[key];
  return typeof val === "string" && val.length > 0 ? val : null;
}

function getNumber(
  obj: Record<string, unknown>,
  key: string
): number | null {
  const val = obj[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}
