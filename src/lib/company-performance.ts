import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const COMPANY_PERFORMANCE_TIME_ZONE = "America/Toronto";
export const COMPANY_PERFORMANCE_TIME_ZONE_LABEL = "Toronto time";

export type CompanyPerformanceRange = "today" | "week" | "month";

export interface CompanyPerformanceWindow {
  range: CompanyPerformanceRange;
  start: Date;
  end: Date;
  timezone: typeof COMPANY_PERFORMANCE_TIME_ZONE;
  timezoneLabel: typeof COMPANY_PERFORMANCE_TIME_ZONE_LABEL;
}

export interface MonthComparisonWindows {
  timezone: typeof COMPANY_PERFORMANCE_TIME_ZONE;
  timezoneLabel: typeof COMPANY_PERFORMANCE_TIME_ZONE_LABEL;
  current: {
    start: Date;
    end: Date;
  };
  previous: {
    start: Date;
    end: Date;
  };
}

export interface CompanyPerformanceAffiliateInput {
  affiliateId: string;
  displayName: string;
  email?: string | null;
  conversions: number;
  paidCommissionCents: number;
  visible: boolean;
}

export interface ShapeCompanyPerformanceInput {
  range: CompanyPerformanceRange;
  window: CompanyPerformanceWindow;
  affiliates: CompanyPerformanceAffiliateInput[];
  includeFinancials: boolean;
}

type LeaderboardRow = {
  rank: number;
  affiliateId: string;
  displayName: string;
  conversions: number;
  email?: string | null;
  paidCommissionCents?: number;
};

type PerformanceTotals = {
  conversions: number;
  affiliateCount: number;
  hiddenAffiliateCount: number;
  visibleAffiliateCount: number;
  totalPaidCommissionCents?: number;
};

function getTorontoParts(date: Date) {
  const zoned = toZonedTime(date, COMPANY_PERFORMANCE_TIME_ZONE);
  return {
    year: zoned.getFullYear(),
    monthIndex: zoned.getMonth(),
    day: zoned.getDate(),
    weekday: zoned.getDay(),
  };
}

function fromTorontoLocalDate(
  year: number,
  monthIndex: number,
  day: number
) {
  return fromZonedTime(
    new Date(year, monthIndex, day, 0, 0, 0, 0),
    COMPANY_PERFORMANCE_TIME_ZONE
  );
}

export function getTorontoReportingWindow(
  range: CompanyPerformanceRange,
  now = new Date()
): CompanyPerformanceWindow {
  const parts = getTorontoParts(now);
  let start: Date;

  if (range === "today") {
    start = fromTorontoLocalDate(parts.year, parts.monthIndex, parts.day);
  } else if (range === "week") {
    const daysSinceMonday = (parts.weekday + 6) % 7;
    start = fromTorontoLocalDate(
      parts.year,
      parts.monthIndex,
      parts.day - daysSinceMonday
    );
  } else {
    start = fromTorontoLocalDate(parts.year, parts.monthIndex, 1);
  }

  return {
    range,
    start,
    end: now,
    timezone: COMPANY_PERFORMANCE_TIME_ZONE,
    timezoneLabel: COMPANY_PERFORMANCE_TIME_ZONE_LABEL,
  };
}

export function getTorontoMonthComparisonWindows(
  now = new Date()
): MonthComparisonWindows {
  const parts = getTorontoParts(now);
  const currentStart = fromTorontoLocalDate(parts.year, parts.monthIndex, 1);
  const previousStart = fromTorontoLocalDate(parts.year, parts.monthIndex - 1, 1);

  return {
    timezone: COMPANY_PERFORMANCE_TIME_ZONE,
    timezoneLabel: COMPANY_PERFORMANCE_TIME_ZONE_LABEL,
    current: {
      start: currentStart,
      end: now,
    },
    previous: {
      start: previousStart,
      end: currentStart,
    },
  };
}

function cleanCount(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function cleanCents(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

function sortLeaderboardRows(
  rows: CompanyPerformanceAffiliateInput[]
): CompanyPerformanceAffiliateInput[] {
  return [...rows].sort((a, b) => {
    const byConversions = cleanCount(b.conversions) - cleanCount(a.conversions);
    if (byConversions !== 0) return byConversions;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function shapeCompanyPerformancePayload(
  input: ShapeCompanyPerformanceInput
) {
  const visibleRows = sortLeaderboardRows(
    input.affiliates.filter((affiliate) => affiliate.visible)
  );
  const hiddenAffiliateCount = input.affiliates.filter(
    (affiliate) => !affiliate.visible
  ).length;
  const conversions = input.affiliates.reduce(
    (sum, affiliate) => sum + cleanCount(affiliate.conversions),
    0
  );

  const totals: PerformanceTotals = {
    conversions,
    affiliateCount: input.affiliates.length,
    hiddenAffiliateCount,
    visibleAffiliateCount: visibleRows.length,
  };

  if (input.includeFinancials) {
    totals.totalPaidCommissionCents = input.affiliates.reduce(
      (sum, affiliate) => sum + cleanCents(affiliate.paidCommissionCents),
      0
    );
  }

  const leaderboard: LeaderboardRow[] = visibleRows.map((affiliate, index) => {
    const baseRow: LeaderboardRow = {
      rank: index + 1,
      affiliateId: affiliate.affiliateId,
      displayName: affiliate.displayName,
      conversions: cleanCount(affiliate.conversions),
    };

    if (!input.includeFinancials) {
      return baseRow;
    }

    return {
      ...baseRow,
      email: affiliate.email ?? null,
      paidCommissionCents: cleanCents(affiliate.paidCommissionCents),
    };
  });

  return {
    source: input,
    range: input.range,
    startsAt: input.window.start.toISOString(),
    endsAt: input.window.end.toISOString(),
    timezone: input.window.timezone,
    timezoneLabel: input.window.timezoneLabel,
    totals,
    leaderboard,
  };
}
