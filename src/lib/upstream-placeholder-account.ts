export interface ClaimableUpstreamPlaceholderInput {
  passwordHash: string | null;
  rewardfulAffiliateId: string | null;
  accounts: readonly unknown[];
}

export function canClaimUpstreamPlaceholder(
  input: ClaimableUpstreamPlaceholderInput
) {
  return (
    input.passwordHash === null &&
    input.rewardfulAffiliateId !== null &&
    input.accounts.length === 0
  );
}
