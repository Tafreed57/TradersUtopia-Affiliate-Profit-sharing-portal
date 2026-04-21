import crypto from "crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  processConversion,
  type WebhookConversion,
} from "@/lib/commission-engine";
import { createNotifications } from "@/lib/notifications";
import { handleCommissionPaid, handleCommissionVoided } from "@/lib/payment-service";

/**
 * POST /api/webhooks/rewardful
 *
 * Receives Rewardful conversion webhooks. This endpoint is public
 * (no auth required) but validated via HMAC signature when a secret is set.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const payload = JSON.parse(body);

    // Validate webhook signature if secret is configured
    const secret = process.env.REWARDFUL_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers.get("x-rewardful-signature") ?? "";
      const expected = crypto
        .createHmac("sha256", secret)
        .update(body)
        .digest("hex");

      if (signature !== expected) {
        console.error("Webhook signature mismatch");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 }
        );
      }
    }

    const eventType = extractEventType(payload);

    // State-change event: commission.updated with state=paid or state=voided
    if (eventType.toLowerCase() === "commission.updated") {
      const data = extractCommissionObject(payload);
      const state = (data.state as string | undefined) ?? "";
      const rewardfulCommissionId = (data.id as string | undefined) ?? "";
      if (!rewardfulCommissionId) {
        return NextResponse.json({ error: "Missing commission id" }, { status: 400 });
      }

      if (state === "paid") {
        const paidAtStr = (data.paid_at as string | undefined) ?? new Date().toISOString();
        const result = await handleCommissionPaid(rewardfulCommissionId, new Date(paidAtStr));
        return NextResponse.json({ ok: true, ...result });
      }

      if (state === "voided") {
        const voidedAtStr = (data.voided_at as string | undefined) ?? new Date().toISOString();
        const result = await handleCommissionVoided(rewardfulCommissionId, new Date(voidedAtStr));
        return NextResponse.json({ ok: true, ...result });
      }

      return NextResponse.json({ status: "ignored", reason: `state_${state}` });
    }

    // Conversion event: create/process new commission
    if (!isConversionEvent(eventType)) {
      return NextResponse.json({ status: "ignored", event: eventType });
    }

    const conversion = extractConversion(payload);
    if (!conversion) {
      console.error("Could not extract conversion data from webhook:", payload);
      return NextResponse.json(
        { error: "Invalid conversion payload" },
        { status: 400 }
      );
    }

    const result = await processConversion(conversion);

    if (result.warnings?.length) {
      console.warn("Commission warnings:", result.warnings);
    }

    if (result.success && !result.skipped && result.notifications) {
      await createNotifications(result.notifications);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      const frames = (error.stack ?? "")
        .split("\n")
        .slice(1, 5)
        .map((f) => f.trim().replace(/^at\s+/, ""))
        .join(" << ");
      console.error(
        `WHK_ERR ${error.name}: ${error.message} @ ${frames}`
      );
    } else {
      console.error(`WHK_ERR RAW ${JSON.stringify(error)}`);
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isConversionEvent(event: unknown): boolean {
  if (typeof event !== "string" || event.length === 0) return false;
  const conversionEvents = [
    "conversion.created",
    "commission.created",
    "sale.created",
    "referral.conversion",
  ];
  return conversionEvents.includes(event.toLowerCase());
}

/**
 * Extract the event type string from a webhook payload.
 *
 * Live Rewardful webhooks wrap the type in an object:
 *   { "event": { "type": "commission.created", ... }, "object": {...} }
 * Older / test-harness payloads put the type directly as a string on
 * `payload.event` or `payload.type`. All three forms are accepted.
 */
function extractEventType(payload: Record<string, unknown>): string {
  const wrapper = payload.event;
  if (wrapper && typeof wrapper === "object") {
    const t = (wrapper as Record<string, unknown>).type;
    if (typeof t === "string") return t;
  }
  if (typeof wrapper === "string") return wrapper;
  if (typeof payload.type === "string") return payload.type as string;
  return "";
}

/**
 * Resolve the commission-shaped object inside a webhook payload.
 *
 * Live Rewardful webhooks wrap the commission fields under `payload.object`.
 * Older shapes used `payload.data` or `payload.commission`; the outer payload
 * itself is the last-resort fallback for unwrapped test harnesses.
 */
function extractCommissionObject(
  payload: Record<string, unknown>
): Record<string, unknown> {
  // `??` alone would accept a string discriminator (e.g. `object: "commission"`)
  // and pass a non-object to getString/getNumber — guard with typeof.
  for (const candidate of [payload.object, payload.data, payload.commission]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return payload;
}

/**
 * Extract conversion data from various Rewardful webhook payload formats.
 * Handles both v1 and v2 webhook structures.
 */
function extractConversion(
  payload: Record<string, unknown>
): WebhookConversion | null {
  const data = extractCommissionObject(payload);

  const commissionId =
    getString(data, "id") ?? getString(payload, "commission_id");
  if (!commissionId) return null;

  // Live Rewardful webhook shape (verified 2026-04-20) nests the sale object,
  // which holds the ground-truth gross sale amount + affiliate identity +
  // referral + charge timestamp. `data.*` shorthand fields are commission-
  // level (payout after campaign %) or legacy wire-format fallbacks.
  const saleObj = (data.sale as Record<string, unknown>) ?? {};

  // Amount — use the sale's gross amount so `processConversion` splits on the
  // full customer charge, not the commission-level payout (which would be
  // tiny on sub-100% campaigns and cause underpayment).
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

  // Affiliate ID. `data.affiliate_id` + `data.affiliate.id` are legacy
  // fallbacks that never fire against live payloads.
  const affiliateId =
    getString(data, "affiliate_id") ??
    getString(
      (data.affiliate as Record<string, unknown>) ?? {},
      "id"
    ) ??
    getString(
      (saleObj.affiliate as Record<string, unknown>) ?? {},
      "id"
    ) ??
    getString(payload, "affiliate_id");
  if (!affiliateId) return null;

  // Referral ID. Rewardful nests this at sale.referral.id; the older
  // data.referral_id / data.referral.id paths never fire against real
  // payloads but are kept as fallbacks for future shape changes.
  const referralId =
    getString(
      (saleObj.referral as Record<string, unknown>) ?? {},
      "id"
    ) ??
    getString(data, "referral_id") ??
    getString(
      (data.referral as Record<string, unknown>) ?? {},
      "id"
    );

  // Conversion date — prefer sale.charged_at (actual charge time) over
  // commission.created_at (when Rewardful recorded the commission, which can
  // lag the charge by seconds-to-minutes). Attendance gating + initial-vs-
  // recurring classification both key on this date; using the charge time
  // matches the backfill path and keeps classification stable.
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
    return isNaN(n) ? null : n;
  }
  return null;
}
