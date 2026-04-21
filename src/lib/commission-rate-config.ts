/**
 * Affiliate commission-rate configuration state.
 *
 * Numeric 0 is a valid configured rate. We therefore cannot infer "unset"
 * from the stored percent itself. `ratesConfiguredAt` is the canonical flag:
 * null = onboarding/unset, non-null = the current numeric rates are live.
 */
export function hasConfiguredCommissionRates(input: {
  ratesConfiguredAt: Date | null;
}): boolean {
  return input.ratesConfiguredAt !== null;
}
