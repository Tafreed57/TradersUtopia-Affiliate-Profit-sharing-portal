import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { listCampaigns } from "@/lib/rewardful";

/**
 * GET /api/admin/campaigns
 *
 * Admin-only. Returns up to 100 commission plans available for promo code creation.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await listCampaigns({ limit: 100 });
    const plans = result.data.map((c) => ({
      id: c.id,
      name: c.name,
      url: c.url,
      isDefault: c.default,
      rewardType: c.reward_type,
      commissionPercent: c.reward_type === "percent" ? c.commission_percent : null,
      commissionAmountCents: c.reward_type === "amount" ? c.commission_amount_cents : null,
      commissionAmountCurrency: c.reward_type === "amount" ? c.commission_amount_currency : null,
    }));
    return NextResponse.json({ data: plans });
  } catch (error) {
    console.error("Failed to fetch commission plans:", error);
    return NextResponse.json(
      { error: "Failed to fetch commission plans" },
      { status: 500 }
    );
  }
}
