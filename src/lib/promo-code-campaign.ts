import type { RewardfulCampaign } from "./rewardful.ts";

export function selectPromoCodeCampaign(
  campaigns: RewardfulCampaign[],
  campaignId?: string
): RewardfulCampaign {
  if (campaigns.length === 0) {
    throw new Error("No commission plans found");
  }

  const selected = campaignId
    ? campaigns.find((campaign) => campaign.id === campaignId)
    : campaigns.find((campaign) => campaign.default) ?? campaigns[0];

  if (!selected) {
    throw new Error("Specified commission plan not found");
  }

  return selected;
}

export function formatPromoCodeCreationError(error: unknown): string {
  const apiError = error as { status?: unknown; body?: unknown };
  if (
    typeof apiError.status === "number" &&
    typeof apiError.body === "string"
  ) {
    const body = apiError.body.toLowerCase();

    if (
      apiError.status === 409 ||
      body.includes("already") ||
      body.includes("taken") ||
      body.includes("duplicate")
    ) {
      return "This promo code is already unavailable. Try a different code.";
    }

    if (apiError.status === 404) {
      return "The affiliate account for this promo code could not be found.";
    }

    if (apiError.status === 422) {
      return "That promo code could not be created. Try another code.";
    }
  }

  if (error instanceof Error) {
    if (
      error.message === "No commission plans found" ||
      error.message === "Specified commission plan not found"
    ) {
      return error.message;
    }
  }

  return "The promo code could not be created right now. Try again later.";
}
