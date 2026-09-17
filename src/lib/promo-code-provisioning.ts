/** Provider-independent creation workflow, including recovery after uncertain writes. */
export interface ProvisioningCoupon {
  id: string;
  token?: string;
  code?: string;
  archived?: boolean;
  affiliate_id?: string;
  campaign?: { id: string; name?: string } | null;
}

export type ProvisioningClaim =
  | { kind: "claimed"; token: string }
  | { kind: "busy" | "created" | "unavailable" };

export interface PromoProvisioningDependencies {
  claim(): Promise<ProvisioningClaim>;
  list(): Promise<ProvisioningCoupon[]>;
  create(): Promise<ProvisioningCoupon>;
  complete(token: string, coupon: ProvisioningCoupon): Promise<boolean>;
  fail(token: string, error: unknown): Promise<void>;
}

export async function provisionPromoCode(
  code: string,
  affiliateId: string,
  dependencies: PromoProvisioningDependencies
): Promise<"created" | "busy" | "failed" | "unavailable"> {
  const claim = await dependencies.claim();
  if (claim.kind !== "claimed") return claim.kind;

  const findOwned = (coupons: ProvisioningCoupon[]) =>
    coupons.find((coupon) =>
      coupon.archived !== true &&
      (!coupon.affiliate_id || coupon.affiliate_id === affiliateId) &&
      (coupon.token ?? coupon.code ?? "").toUpperCase() === code
    );

  try {
    let coupon = findOwned(await dependencies.list());
    if (!coupon) {
      try {
        coupon = await dependencies.create();
      } catch (error) {
        // A timeout, lost response, or duplicate error can follow a successful
        // provider write. Only repair from this affiliate's active coupons.
        coupon = findOwned(await dependencies.list().catch(() => []));
        if (!coupon) throw error;
      }
    }
    return await dependencies.complete(claim.token, coupon) ? "created" : "busy";
  } catch (error) {
    await dependencies.fail(claim.token, error);
    return "failed";
  }
}
