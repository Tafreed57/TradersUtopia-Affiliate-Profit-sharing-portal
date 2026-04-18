import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const BATCH_CONCURRENCY = 5;

export interface StudentRewardfulStats {
  unpaidCents: number;
  paidCents: number;
  dueCents: number;
  fetchedAt: string;
  stale: boolean;
  reason: "ok" | "stale-cache" | "timeout" | "error";
}

interface CachedPayload {
  unpaidCents?: number;
  paidCents?: number;
  dueCents?: number;
  totalCommissionCents?: number;
  visitors?: number;
  leads?: number;
  conversions?: number;
  conversionRate?: number;
  unpaidCad?: number;
  paidCad?: number;
  dueCad?: number;
  grossEarnedCad?: number;
  coupons?: Array<{ id: string; code: string }>;
  fetchedAt?: string;
  cacheVersion?: number;
}

function withTimeout<T>(
  runner: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${ms}ms`)), ms);
  return runner(controller.signal).finally(() => clearTimeout(timer));
}

function isFresh(cachedAt: Date | null, cached: CachedPayload | null): boolean {
  return (
    cached?.unpaidCents != null &&
    cachedAt != null &&
    Date.now() - cachedAt.getTime() < CACHE_TTL_MS
  );
}

function fromCache(
  cached: CachedPayload,
  cachedAt: Date,
  stale: boolean
): StudentRewardfulStats {
  return {
    unpaidCents: cached.unpaidCents ?? 0,
    paidCents: cached.paidCents ?? 0,
    dueCents: cached.dueCents ?? 0,
    fetchedAt: cachedAt.toISOString(),
    stale,
    reason: stale ? "stale-cache" : "ok",
  };
}

async function fetchAndCache(
  studentUserId: string,
  rewardfulAffiliateId: string,
  commissionPercent: number
): Promise<rewardful.AffiliateLifetimeStats> {
  const stats = await withTimeout(
    (signal) => rewardful.getAffiliateLifetimeStats(rewardfulAffiliateId, signal),
    FETCH_TIMEOUT_MS
  );

  const rate = commissionPercent;
  const applyRate = (cents: number) => Math.round((cents * rate) / 100) / 100;

  const payload: CachedPayload = {
    visitors: stats.visitors,
    leads: stats.leads,
    conversions: stats.conversions,
    conversionRate: stats.conversionRate,
    unpaidCents: stats.unpaidCents,
    paidCents: stats.paidCents,
    dueCents: stats.dueCents,
    totalCommissionCents: stats.totalCommissionCents,
    unpaidCad: applyRate(stats.unpaidCents),
    paidCad: applyRate(stats.paidCents),
    dueCad: applyRate(stats.dueCents),
    grossEarnedCad: applyRate(stats.totalCommissionCents),
    coupons: stats.coupons,
    fetchedAt: stats.fetchedAt,
    cacheVersion: 3,
  };

  await prisma.user.update({
    where: { id: studentUserId },
    data: {
      lifetimeStatsJson: payload as unknown as object,
      lifetimeStatsCachedAt: new Date(),
    },
  });

  return stats;
}

export async function getStudentRewardfulStats(
  studentUserId: string
): Promise<StudentRewardfulStats | null> {
  const user = await prisma.user.findUnique({
    where: { id: studentUserId },
    select: {
      rewardfulAffiliateId: true,
      commissionPercent: true,
      lifetimeStatsJson: true,
      lifetimeStatsCachedAt: true,
    },
  });

  if (!user?.rewardfulAffiliateId) return null;

  const cached = user.lifetimeStatsJson as unknown as CachedPayload | null;
  const cachedAt = user.lifetimeStatsCachedAt;

  if (isFresh(cachedAt, cached) && cached && cachedAt) {
    return fromCache(cached, cachedAt, false);
  }

  try {
    const stats = await fetchAndCache(
      studentUserId,
      user.rewardfulAffiliateId,
      Number(user.commissionPercent)
    );
    return {
      unpaidCents: stats.unpaidCents,
      paidCents: stats.paidCents,
      dueCents: stats.dueCents,
      fetchedAt: stats.fetchedAt,
      stale: false,
      reason: "ok",
    };
  } catch (err) {
    const reason: StudentRewardfulStats["reason"] =
      err instanceof Error && err.message.startsWith("timeout")
        ? "timeout"
        : "error";
    console.error(
      `[student-stats] fetch failed for ${studentUserId} (${reason}):`,
      err instanceof Error ? err.message : err
    );

    if (cached?.unpaidCents != null && cachedAt) {
      return fromCache(cached, cachedAt, true);
    }
    return null;
  }
}

async function runBatch<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(runners);
  return results;
}

export async function getStudentRewardfulStatsBatch(
  studentUserIds: string[]
): Promise<Map<string, StudentRewardfulStats | null>> {
  const ids = Array.from(new Set(studentUserIds));
  if (ids.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      rewardfulAffiliateId: true,
      commissionPercent: true,
      lifetimeStatsJson: true,
      lifetimeStatsCachedAt: true,
    },
  });

  const userById = new Map(users.map((u) => [u.id, u] as const));
  const result = new Map<string, StudentRewardfulStats | null>();

  const needsFetch: typeof users = [];

  for (const id of ids) {
    const user = userById.get(id);
    if (!user?.rewardfulAffiliateId) {
      result.set(id, null);
      continue;
    }
    const cached = user.lifetimeStatsJson as unknown as CachedPayload | null;
    const cachedAt = user.lifetimeStatsCachedAt;
    if (isFresh(cachedAt, cached) && cached && cachedAt) {
      result.set(id, fromCache(cached, cachedAt, false));
    } else {
      needsFetch.push(user);
    }
  }

  if (needsFetch.length > 0) {
    await runBatch(needsFetch, BATCH_CONCURRENCY, async (user) => {
      const cached = user.lifetimeStatsJson as unknown as CachedPayload | null;
      const cachedAt = user.lifetimeStatsCachedAt;
      try {
        const stats = await fetchAndCache(
          user.id,
          user.rewardfulAffiliateId!,
          Number(user.commissionPercent)
        );
        result.set(user.id, {
          unpaidCents: stats.unpaidCents,
          paidCents: stats.paidCents,
          dueCents: stats.dueCents,
          fetchedAt: stats.fetchedAt,
          stale: false,
          reason: "ok",
        });
      } catch (err) {
        const reason: StudentRewardfulStats["reason"] =
          err instanceof Error && err.message.startsWith("timeout")
            ? "timeout"
            : "error";
        console.error(
          `[student-stats] batch fetch failed for ${user.id} (${reason}):`,
          err instanceof Error ? err.message : err
        );
        if (cached?.unpaidCents != null && cachedAt) {
          result.set(user.id, fromCache(cached, cachedAt, true));
        } else {
          result.set(user.id, null);
        }
      }
    });
  }

  return result;
}
