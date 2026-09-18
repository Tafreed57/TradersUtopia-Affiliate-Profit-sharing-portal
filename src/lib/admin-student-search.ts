type UpstreamAffiliateLike = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
};

export type PortalStudentSearchUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  rewardfulAffiliateId: string | null;
};

export type AdminStudentSearchResult = {
  id: string;
  source: "portal" | "upstream";
  portalUserId: string | null;
  upstreamAffiliateId: string | null;
  name: string | null;
  email: string;
  image: string | null;
};

export function rewardfulAffiliateDisplayName(
  affiliate: Pick<UpstreamAffiliateLike, "first_name" | "last_name" | "email">
): string | null {
  const name = [affiliate.first_name, affiliate.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return name || null;
}

export function matchesRewardfulAffiliateQuery(
  affiliate: UpstreamAffiliateLike,
  query: string
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;

  const name = rewardfulAffiliateDisplayName(affiliate)?.toLowerCase() ?? "";
  return (
    affiliate.email.toLowerCase().includes(needle) || name.includes(needle)
  );
}

export function mergeAdminStudentSearchResults(args: {
  query: string;
  portalUsers: PortalStudentSearchUser[];
  upstreamAffiliates: UpstreamAffiliateLike[];
  excludedUserIds: Set<string>;
  limit?: number;
}): AdminStudentSearchResult[] {
  const limit = args.limit ?? 10;
  const rows: AdminStudentSearchResult[] = [];
  const seenEmails = new Set<string>();
  const seenUpstreamIds = new Set<string>();

  for (const user of args.portalUsers) {
    if (args.excludedUserIds.has(user.id)) continue;

    rows.push({
      id: user.id,
      source: "portal",
      portalUserId: user.id,
      upstreamAffiliateId: user.rewardfulAffiliateId,
      name: user.name,
      email: user.email,
      image: user.image,
    });
    seenEmails.add(user.email.toLowerCase());
    if (user.rewardfulAffiliateId) seenUpstreamIds.add(user.rewardfulAffiliateId);
    if (rows.length >= limit) return rows;
  }

  for (const affiliate of args.upstreamAffiliates) {
    if (!matchesRewardfulAffiliateQuery(affiliate, args.query)) continue;

    const normalizedEmail = affiliate.email.toLowerCase();
    if (seenEmails.has(normalizedEmail) || seenUpstreamIds.has(affiliate.id)) {
      continue;
    }

    rows.push({
      id: `upstream:${affiliate.id}`,
      source: "upstream",
      portalUserId: null,
      upstreamAffiliateId: affiliate.id,
      name: rewardfulAffiliateDisplayName(affiliate),
      email: normalizedEmail,
      image: null,
    });
    seenEmails.add(normalizedEmail);
    seenUpstreamIds.add(affiliate.id);
    if (rows.length >= limit) return rows;
  }

  return rows;
}
