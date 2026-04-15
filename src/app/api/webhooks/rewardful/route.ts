import crypto from "crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  processConversion,
  type WebhookConversion,
} from "@/lib/commission-engine";
import { createNotifications } from "@/lib/notifications";

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

    // Rewardful sends various event types — we only care about conversions
    const eventType = payload.event ?? payload.type;
    if (!isConversionEvent(eventType)) {
      return NextResponse.json({ status: "ignored", event: eventType });
    }

    // Extract conversion data from webhook payload
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

    // Send notifications for the conversion
    if (result.success && !result.skipped && result.notifications) {
      await createNotifications(result.notifications);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`WHK_ERR_NAME | ${error.name}`);
      console.error(`WHK_ERR_MSG | ${error.message}`);
      const frames = (error.stack ?? "").split("\n").slice(1, 6);
      frames.forEach((f, i) => console.error(`WHK_ERR_F${i} | ${f.trim()}`));
    } else {
      console.error(`WHK_ERR_RAW | ${JSON.stringify(error)}`);
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

function isConversionEvent(event: string | undefined): boolean {
  if (!event) return false;
  const conversionEvents = [
    "conversion.created",
    "commission.created",
    "sale.created",
    "referral.conversion",
  ];
  return conversionEvents.includes(event.toLowerCase());
}

/**
 * Extract conversion data from various Rewardful webhook payload formats.
 * Handles both v1 and v2 webhook structures.
 */
function extractConversion(
  payload: Record<string, unknown>
): WebhookConversion | null {
  // Try nested data structure first (common in v1 webhooks)
  const data =
    (payload.data as Record<string, unknown>) ??
    (payload.commission as Record<string, unknown>) ??
    payload;

  const commissionId =
    getString(data, "id") ?? getString(payload, "commission_id");
  if (!commissionId) return null;

  // Amount — Rewardful amounts are in cents, convert to dollars
  const amountRaw =
    getNumber(data, "amount") ??
    getNumber(data, "sale_amount") ??
    getNumber(payload, "amount");
  if (amountRaw == null) return null;

  // Rewardful sends amounts in cents
  const amountCad = amountRaw / 100;

  // Affiliate ID
  const affiliateId =
    getString(data, "affiliate_id") ??
    getString(
      (data.affiliate as Record<string, unknown>) ?? {},
      "id"
    ) ??
    getString(payload, "affiliate_id");
  if (!affiliateId) return null;

  // Referral ID
  const referralId =
    getString(data, "referral_id") ??
    getString(
      (data.referral as Record<string, unknown>) ?? {},
      "id"
    );

  // Conversion date
  const dateStr =
    getString(data, "created_at") ??
    getString(data, "charged_at") ??
    getString(payload, "created_at") ??
    new Date().toISOString();

  return {
    rewardfulCommissionId: commissionId,
    rewardfulReferralId: referralId ?? undefined,
    affiliateRewardfulId: affiliateId,
    amountCad,
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
