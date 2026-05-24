import {
  type CompanyPerformanceAffiliateInput,
  type CompanyPerformanceRange,
  type CompanyPerformanceWindow,
  getTorontoReportingWindow,
  shapeCompanyPerformancePayload,
} from "@/lib/company-performance";
import { prisma } from "@/lib/prisma";
import * as affiliateBackend from "@/lib/rewardful";
import type {
  RewardfulAffiliate,
  RewardfulCommission,
} from "@/lib/rewardful";

const CACHE_TTL_MS = 10 * 60 * 1000;
const AFFILIATE_PAGE_LIMIT = 100;
const COMMISSION_CONCURRENCY = 4;

interface CompanyPerformanceSource {
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

function getAffiliateDisplayName(affiliate: RewardfulAffiliate) {
  const fullName = [affiliate.first_name, affiliate.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) return fullName;
  const emailName = affiliate.email?.split("@")[0]?.trim();
  if (emailName) return emailName;
  return `Affiliate ${affiliate.id.slice(-6)}`;
}

function getCommissionDate(commission: RewardfulCommission) {
  return commission.sale?.charged_at ?? commission.created_at ?? null;
}

function isCommissionInWindow(
  commission: RewardfulCommission,
  window: CompanyPerformanceWindow
) {
  const rawDate = getCommissionDate(commission);
  if (!rawDate) return false;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return false;
  return date >= window.start && date < window.end;
}

function getPaidCommissionCents(commission: RewardfulCommission) {
  if (commission.state !== "paid" && !commission.paid_at) return 0;
  if (!Number.isFinite(commission.amount) || commission.amount < 0) return 0;
  return Math.round(commission.amount);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
) {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

async function listAllBackendAffiliates() {
  const affiliates: RewardfulAffiliate[] = [];
  let page = 1;

  for (let guard = 0; guard < 500; guard += 1) {
    const response = await affiliateBackend.listAffiliates({
      page,
      limit: AFFILIATE_PAGE_LIMIT,
    });
    affiliates.push(...response.data);

    const nextPage = response.pagination?.next_page;
    if (!nextPage || nextPage <= page) break;
    page = nextPage;
  }

  return affiliates;
}

async function syncVisibilityRows(affiliates: RewardfulAffiliate[]) {
  if (affiliates.length === 0) return new Map<string, boolean>();

  const existingRows = await prisma.leaderboardAffiliateVisibility.findMany({
    where: { affiliateId: { in: affiliates.map((affiliate) => affiliate.id) } },
    select: { affiliateId: true, visible: true },
  });
  const existing = new Map(
    existingRows.map((row) => [row.affiliateId, row.visible])
  );

  await mapWithConcurrency(affiliates, 6, (affiliate) =>
    prisma.leaderboardAffiliateVisibility.upsert({
        where: { affiliateId: affiliate.id },
        create: {
          affiliateId: affiliate.id,
          affiliateEmail: affiliate.email ?? null,
          displayName: getAffiliateDisplayName(affiliate),
          visible: true,
        },
        update: {
          affiliateEmail: affiliate.email ?? null,
          displayName: getAffiliateDisplayName(affiliate),
        },
      })
  );

  const refreshedRows = await prisma.leaderboardAffiliateVisibility.findMany({
    where: { affiliateId: { in: affiliates.map((affiliate) => affiliate.id) } },
    select: { affiliateId: true, visible: true },
  });

  return new Map(
    refreshedRows.map((row) => [
      row.affiliateId,
      existing.has(row.affiliateId) ? row.visible : true,
    ])
  );
}

async function buildCompanyPerformanceSource(
  range: CompanyPerformanceRange
): Promise<CompanyPerformanceSource> {
  const window = getTorontoReportingWindow(range);
  const affiliates = await listAllBackendAffiliates();
  const visibility = await syncVisibilityRows(affiliates);

  const rows = await mapWithConcurrency(
    affiliates,
    COMMISSION_CONCURRENCY,
    async (affiliate): Promise<CompanyPerformanceAffiliateInput> => {
      const commissions =
        await affiliateBackend.listAllCommissionsForAffiliate(affiliate.id);
      const inWindow = commissions.filter((commission) =>
        isCommissionInWindow(commission, window)
      );

      return {
        affiliateId: affiliate.id,
        displayName: getAffiliateDisplayName(affiliate),
        email: affiliate.email ?? null,
        conversions: inWindow.length,
        paidCommissionCents: inWindow.reduce(
          (sum, commission) => sum + getPaidCommissionCents(commission),
          0
        ),
        visible: visibility.get(affiliate.id) ?? true,
      };
    }
  );

  return {
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
  const affiliates = await listAllBackendAffiliates();
  const affiliateIds = affiliates.map((affiliate) => affiliate.id);
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
