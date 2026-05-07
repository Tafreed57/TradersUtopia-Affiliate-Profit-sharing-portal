import crypto from "crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  processConversion,
  type WebhookConversion,
} from "@/lib/commission-engine";
import { createNotifications } from "@/lib/notifications";
import { syncCommissionStatesFromCommissions } from "@/lib/paid-sync-service";
import { handleCommissionPaid, handleCommissionVoided } from "@/lib/payment-service";
import { normalizeRewardfulCommissionState } from "@/lib/rewardful";
import {
  extractCommissionObject,
  extractConversion,
  extractEventType,
  isCommissionConversionEvent,
} from "@/lib/rewardful-webhook-parser";

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

    // Validate webhook signature if secret is configured.
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

    // State-change event: commission.updated with state=paid or state=voided.
    if (eventType.toLowerCase() === "commission.updated") {
      const data = extractCommissionObject(payload);
      const state = (data.state as string | undefined) ?? "";
      const rewardfulCommissionId = (data.id as string | undefined) ?? "";
      if (!rewardfulCommissionId) {
        return NextResponse.json(
          { error: "Missing commission id" },
          { status: 400 }
        );
      }

      const campaign =
        data.campaign && typeof data.campaign === "object"
          ? (data.campaign as { id?: string; name?: string })
          : undefined;

      if (state === "paid") {
        const paidAtStr =
          (data.paid_at as string | undefined) ?? new Date().toISOString();
        const result = await handleCommissionPaid(
          rewardfulCommissionId,
          new Date(paidAtStr)
        );
        return NextResponse.json({ ok: true, ...result });
      }

      if (state === "voided") {
        const voidedAtStr =
          (data.voided_at as string | undefined) ?? new Date().toISOString();
        const result = await handleCommissionVoided(
          rewardfulCommissionId,
          new Date(voidedAtStr)
        );
        return NextResponse.json({ ok: true, ...result });
      }

      const syncResult = await syncCommissionStatesFromCommissions([
        {
          id: rewardfulCommissionId,
          state: normalizeRewardfulCommissionState(state) ?? undefined,
          due_at: (data.due_at as string | null | undefined) ?? null,
          paid_at: (data.paid_at as string | null | undefined) ?? null,
          voided_at: (data.voided_at as string | null | undefined) ?? null,
          campaign: campaign
            ? { id: campaign.id ?? "", name: campaign.name ?? "" }
            : undefined,
        },
      ]);

      return NextResponse.json({ ok: true, ...syncResult });
    }

    // Sale events are intentionally ignored here. Commission events carry the
    // stable commission id used for idempotency; sale ids would duplicate rows.
    if (!isCommissionConversionEvent(eventType)) {
      return NextResponse.json({ status: "ignored", event: eventType });
    }

    const conversion = extractConversion(payload) as WebhookConversion | null;
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
      console.error(`WHK_ERR ${error.name}: ${error.message} @ ${frames}`);
    } else {
      console.error(`WHK_ERR RAW ${JSON.stringify(error)}`);
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
