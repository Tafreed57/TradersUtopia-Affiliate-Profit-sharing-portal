import {
  type CompanyPerformanceAffiliateInput,
  type CompanyPerformanceRange,
  type CompanyPerformanceWindow,
  getTorontoReportingWindow,
  shapeCompanyPerformancePayload,
} from "@/lib/company-performance";
import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_VERSION = 2;

interface CompanyPerformanceSource {
  version: typeof CACHE_VERSION;
  range: CompanyPerformanceRange;
  startsAt: string;
  endsAt: string;
  timezone: string;
  timezoneLabel: string;
  affiliates: CompanyPerformanceAffiliateInput[];
  refreshedAt: string;
}

export interface CompanyPerformanceResponse {
  range: CompanyPerformanceRange;
  startsAt: string;
  endsAt: string;
  timezone: string;
  timezoneLabel: string;
  refreshedAt: string;
  stale: boolean;
  totals: ReturnType<typeof shapeCompanyPerformancePayload>["totals"];
  leaderboard: ReturnType<typeof shapeCompanyPerformancePayload>["leaderboard"];
}

export interface LeaderboardVisibilityRow {
  affiliateId: string;
  displayName: string;
  email: string | null;
  visible: boolean;
  updatedAt: string | null;
}

interface KnownAffiliate {
  affiliateId: string;
  userId: string;
  displayName: string;
  email: string | null;
}

function isCompanyPerformanceRange(
  value: string | null
): value is CompanyPerformanceRange {
  return value === "today" || value === "week" || value === "month";
}

export function normalizeCompanyPerformanceRange(
  value: string | null
): CompanyPerformanceRange {
  return isCompanyPerformanceRange(value) ? value : "month";
}

function getKnownAffiliateDisplayName(input: {
  affiliateId: string;
  name?: string | null;
  email?: string | null;
  displayName?: string | null;
}) {
  const name = input.name?.trim() || input.displayName?.trim();
  if (name) return name;
  const emailName = input.email?.split("@")[0]?.trim();
  if (emailName) return emailName;
  return `Affiliate ${input.affiliateId.slice(-6)}`;
}

async function syncVisibilityRows(affiliates: KnownAffiliate[]) {
  if (affiliates.length === 0) return new Map<string, boolean>();

  const existingRows = await prisma.leaderboardAffiliateVisibility.findMany({
    where: {
      affiliateId: { in: affiliates.map((affiliate) => affiliate.affiliateId) },
    },
    select: { affiliateId: true, visible: true },
  });
  const existing = new Map(
    existingRows.map((row) => [row.affiliateId, row.visible])
  );

  await prisma.$transaction(
    affiliates.map((affiliate) =>
      prisma.leaderboardAffiliateVisibility.upsert({
        where: { affiliateId: affiliate.affiliateId },
        create: {
          affiliateId: affiliate.affiliateId,
          affiliateEmail: affiliate.email,
          displayName: affiliate.displayName,
          visible: true,
        },
        update: {
          affiliateEmail: affiliate.email,
          displayName: affiliate.displayName,
        },
      })
    )
  );

  const refreshedRows = await prisma.leaderboardAffiliateVisibility.findMany({
    where: {
      affiliateId: { in: affiliates.map((affiliate) => affiliate.affiliateId) },
    },
    select: { affiliateId: true, visible: true },
  });

  return new Map(
    refreshedRows.map((row) => [
      row.affiliateId,
      existing.has(row.affiliateId) ? row.visible : true,
    ])
  );
}

async function listKnownAffiliates(): Promise<KnownAffiliate[]> {
  const users = await prisma.user.findMany({
    where: { rewardfulAffiliateId: { not: null } },
    select: {
      id: true,
      email: true,
      name: true,
      rewardfulAffiliateId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return users.flatMap((user) => {
    if (!user.rewardfulAffiliateId) return [];

    return [
      {
        affiliateId: user.rewardfulAffiliateId,
        userId: user.id,
        displayName: getKnownAffiliateDisplayName({
          affiliateId: user.rewardfulAffiliateId,
          name: user.name,
          email: user.email,
        }),
        email: user.email,
      },
    ];
  });
}

async function buildCompanyPerformanceSource(
  range: CompanyPerformanceRange
): Promise<CompanyPerformanceSource> {
  const window = getTorontoReportingWindow(range);
  const affiliates = await listKnownAffiliates();
  const visibility = await syncVisibilityRows(affiliates);
  const userIds = affiliates.map((affiliate) => affiliate.userId);

  const [conversionCounts, paidCommissionSums] =
    userIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.commissionEvent.groupBy({
            by: ["affiliateId"],
            where: {
              affiliateId: { in: userIds },
              conversionDate: {
                gte: window.start,
                lt: window.end,
              },
            },
            _count: { _all: true },
          }),
          prisma.commissionSplit.groupBy({
            by: ["recipientId"],
            where: {
              recipientId: { in: userIds },
              role: "AFFILIATE",
              status: "PAID",
              event: {
                conversionDate: {
                  gte: window.start,
                  lt: window.end,
                },
              },
            },
            _sum: { cutAmount: true },
          }),
        ]);

  const conversionsByUserId = new Map(
    conversionCounts.map((row) => [row.affiliateId, row._count._all])
  );
  const paidCentsByUserId = new Map(
    paidCommissionSums.map((row) => [
      row.recipientId,
      Math.round((row._sum.cutAmount?.toNumber() ?? 0) * 100),
    ])
  );

  const rows = affiliates.map(
    (affiliate): CompanyPerformanceAffiliateInput => ({
      affiliateId: affiliate.affiliateId,
      displayName: affiliate.displayName,
      email: affiliate.email,
      conversions: conversionsByUserId.get(affiliate.userId) ?? 0,
      paidCommissionCents: paidCentsByUserId.get(affiliate.userId) ?? 0,
      visible: visibility.get(affiliate.affiliateId) ?? true,
    })
  );

  return {
    version: CACHE_VERSION,
    range,
    startsAt: window.start.toISOString(),
    endsAt: window.end.toISOString(),
    timezone: window.timezone,
    timezoneLabel: window.timezoneLabel,
    affiliates: rows,
    refreshedAt: new Date().toISOString(),
  };
}

function parseCachedSource(payload: unknown): CompanyPerformanceSource | null {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Partial<CompanyPerformanceSource>;
  if (source.version !== CACHE_VERSION) return null;
  if (!isCompanyPerformanceRange(source.range ?? null)) return null;
  if (!Array.isArray(source.affiliates)) return null;
  if (
    typeof source.startsAt !== "string" ||
    typeof source.endsAt !== "string" ||
    typeof source.timezone !== "string" ||
    typeof source.timezoneLabel !== "string" ||
    typeof source.refreshedAt !== "string"
  ) {
    return null;
  }
  return source as CompanyPerformanceSource;
}

function isFreshCache(source: CompanyPerformanceSource, fetchedAt: Date) {
  const currentWindow = getTorontoReportingWindow(source.range);
  const sameWindowStart =
    source.startsAt === currentWindow.start.toISOString();
  const withinTtl = Date.now() - fetchedAt.getTime() < CACHE_TTL_MS;
  return sameWindowStart && withinTtl;
}

async function getCachedSource(range: CompanyPerformanceRange) {
  const row = await prisma.companyPerformanceCache.findUnique({
    where: { range },
  });
  if (!row) return null;
  const source = parseCachedSource(row.payload);
  if (!source) return null;
  return {
    source,
    fetchedAt: row.fetchedAt,
  };
}

async function writeCachedSource(source: CompanyPerformanceSource) {
  await prisma.companyPerformanceCache.upsert({
    where: { range: source.range },
    create: {
      range: source.range,
      payload: source as unknown as object,
      fetchedAt: new Date(source.refreshedAt),
    },
    update: {
      payload: source as unknown as object,
      fetchedAt: new Date(source.refreshedAt),
    },
  });
}

function shapeResponse(
  source: CompanyPerformanceSource,
  includeFinancials: boolean,
  stale: boolean
): CompanyPerformanceResponse {
  const window: CompanyPerformanceWindow = {
    range: source.range,
    start: new Date(source.startsAt),
    end: new Date(source.endsAt),
    timezone: "America/Toronto",
    timezoneLabel: "Toronto time",
  };
  const payload = shapeCompanyPerformancePayload({
    range: source.range,
    window,
    affiliates: source.affiliates,
    includeFinancials,
  });

  return {
    range: payload.range,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    timezone: payload.timezone,
    timezoneLabel: payload.timezoneLabel,
    refreshedAt: source.refreshedAt,
    stale,
    totals: payload.totals,
    leaderboard: payload.leaderboard,
  };
}

export async function getCompanyPerformance({
  range,
  includeFinancials,
}: {
  range: CompanyPerformanceRange;
  includeFinancials: boolean;
}) {
  const cached = await getCachedSource(range);
  if (cached && isFreshCache(cached.source, cached.fetchedAt)) {
    return shapeResponse(cached.source, includeFinancials, false);
  }

  try {
    const freshSource = await buildCompanyPerformanceSource(range);
    await writeCachedSource(freshSource);
    return shapeResponse(freshSource, includeFinancials, false);
  } catch (error) {
    if (cached) {
      console.error("[company-performance] refresh failed, serving stale cache:", error);
      return shapeResponse(cached.source, includeFinancials, true);
    }
    throw error;
  }
}

export async function getLeaderboardVisibilityRows(): Promise<
  LeaderboardVisibilityRow[]
> {
  const affiliates = await listKnownAffiliates();
  const affiliateIds = affiliates.map((affiliate) => affiliate.affiliateId);
  await syncVisibilityRows(affiliates);

  const rows = await prisma.leaderboardAffiliateVisibility.findMany({
    where: { affiliateId: { in: affiliateIds } },
    orderBy: [{ displayName: "asc" }, { affiliateEmail: "asc" }],
    select: {
      affiliateId: true,
      affiliateEmail: true,
      displayName: true,
      visible: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({
    affiliateId: row.affiliateId,
    displayName: row.displayName ?? `Affiliate ${row.affiliateId.slice(-6)}`,
    email: row.affiliateEmail,
    visible: row.visible,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }));
}

export async function updateLeaderboardVisibility({
  affiliateId,
  visible,
  updatedById,
}: {
  affiliateId: string;
  visible: boolean;
  updatedById: string;
}) {
  const row = await prisma.leaderboardAffiliateVisibility.upsert({
    where: { affiliateId },
    create: {
      affiliateId,
      visible,
      updatedById,
    },
    update: {
      visible,
      updatedById,
    },
    select: {
      affiliateId: true,
      affiliateEmail: true,
      displayName: true,
      visible: true,
      updatedAt: true,
    },
  });

  await prisma.companyPerformanceCache.deleteMany();

  return row;
}
