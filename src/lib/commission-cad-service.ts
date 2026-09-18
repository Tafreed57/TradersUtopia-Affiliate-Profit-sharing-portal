import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";

import {
  allocateCommissionCad,
  allocateCutCad,
  upstreamCadStateTotals,
  type CadStateTotals,
} from "@/lib/commission-cad-allocation";
import { getCadToUsdRate } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";

const UPSTREAM_CAD_CACHE_TTL_MS = 5 * 60 * 1000;

export interface UpstreamCadBaseCache {
  paidCad: string;
  unpaidCad: string;
  dueCad: string;
  pendingCad: string;
  fetchedAt: string;
}

export interface AffiliateCadAllocation {
  eventCadById: Map<string, Decimal>;
  splitCadById: Map<string, Decimal>;
  stale: boolean;
  reason: "ok" | "stale" | "unavailable";
  upstreamCadBase: UpstreamCadBaseCache | null;
}

interface ProviderCadUpdate {
  id: string;
  amountCad: Decimal;
  force?: boolean;
}

type JsonObject = Record<string, unknown>;

function asJsonObject(value: Prisma.JsonValue | null): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function readCachedBase(value: Prisma.JsonValue | null): UpstreamCadBaseCache | null {
  const candidate = asJsonObject(value).upstreamCadBase;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const base = candidate as JsonObject;
  const keys = ["paidCad", "unpaidCad", "dueCad", "pendingCad", "fetchedAt"];
  if (!keys.every((key) => typeof base[key] === "string")) return null;
  return base as unknown as UpstreamCadBaseCache;
}

function baseFromStats(
  stats: rewardful.AffiliateLifetimeStats
): UpstreamCadBaseCache {
  const totals = upstreamCadStateTotals(stats);
  const dueCad = new Decimal(totals.dueCad);
  const pendingCad = new Decimal(totals.pendingCad);
  return {
    paidCad: new Decimal(totals.paidCad).toString(),
    unpaidCad: dueCad.add(pendingCad).toString(),
    dueCad: dueCad.toString(),
    pendingCad: pendingCad.toString(),
    fetchedAt: stats.fetchedAt,
  };
}

function baseTotals(base: UpstreamCadBaseCache): CadStateTotals {
  return {
    paidCad: base.paidCad,
    dueCad: base.dueCad,
    pendingCad: base.pendingCad,
  };
}

function baseIsFresh(base: UpstreamCadBaseCache | null): boolean {
  if (!base) return false;
  const fetchedAt = new Date(base.fetchedAt).getTime();
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < UPSTREAM_CAD_CACHE_TTL_MS;
}

async function persistProviderCadUpdates(input: {
  events: ProviderCadUpdate[];
  splits: ProviderCadUpdate[];
}) {
  const writes: Prisma.PrismaPromise<unknown>[] = [];

  for (const event of input.events) {
    writes.push(
      prisma.commissionEvent.updateMany({
        where: event.force
          ? { id: event.id }
          : {
              id: event.id,
              providerFullAmountCad: null,
            },
        data: {
          providerFullAmountCad: event.amountCad
            .toDecimalPlaces(2)
            .toNumber(),
        },
      })
    );
  }

  for (const split of input.splits) {
    writes.push(
      prisma.commissionSplit.updateMany({
        where: split.force
          ? { id: split.id }
          : {
              id: split.id,
              providerCutCad: null,
            },
        data: {
          providerCutCad: split.amountCad.toDecimalPlaces(2).toNumber(),
        },
      })
    );
  }

  if (writes.length === 0) return;

  for (let i = 0; i < writes.length; i += 100) {
    await prisma.$transaction(writes.slice(i, i + 100));
  }
}

async function loadCadBases(
  users: Array<{
    id: string;
    rewardfulAffiliateId: string | null;
    lifetimeStatsJson: Prisma.JsonValue | null;
  }>,
  providedStatsByUserId: Map<string, rewardful.AffiliateLifetimeStats>
) {
  const result = new Map<
    string,
    { base: UpstreamCadBaseCache | null; stale: boolean }
  >();

  await Promise.all(
    users.map(async (user) => {
      const provided = providedStatsByUserId.get(user.id);
      if (provided) {
        result.set(user.id, { base: baseFromStats(provided), stale: false });
        return;
      }

      const cached = readCachedBase(user.lifetimeStatsJson);
      if (baseIsFresh(cached)) {
        result.set(user.id, { base: cached, stale: false });
        return;
      }

      if (!user.rewardfulAffiliateId) {
        result.set(user.id, { base: cached, stale: Boolean(cached) });
        return;
      }

      try {
        const stats = await rewardful.getAffiliateLifetimeStats(
          user.rewardfulAffiliateId
        );
        const base = baseFromStats(stats);
        const merged = {
          ...asJsonObject(user.lifetimeStatsJson),
          upstreamCadBase: base,
        };
        await prisma.user.update({
          where: { id: user.id },
          data: {
            lifetimeStatsJson: merged as unknown as Prisma.InputJsonValue,
          },
        });
        result.set(user.id, { base, stale: false });
      } catch (error) {
        console.error(`[commission-cad] upstream totals unavailable for ${user.id}:`, error);
        result.set(user.id, { base: cached, stale: Boolean(cached) });
      }
    })
  );

  return result;
}

export async function getCommissionCadAllocations(
  affiliateIds: string[],
  options?: {
    providedStatsByUserId?: Map<string, rewardful.AffiliateLifetimeStats>;
  }
): Promise<Map<string, AffiliateCadAllocation>> {
  const ids = [...new Set(affiliateIds.filter(Boolean))];
  const output = new Map<string, AffiliateCadAllocation>();
  if (ids.length === 0) return output;

  const [users, events, exchangeRate] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        rewardfulAffiliateId: true,
        lifetimeStatsJson: true,
      },
    }),
    prisma.commissionEvent.findMany({
      where: { affiliateId: { in: ids } },
      select: {
        id: true,
        affiliateId: true,
        fullAmount: true,
        providerFullAmountCad: true,
        currency: true,
        upstreamState: true,
        upstreamPaidAt: true,
        upstreamVoidedAt: true,
        splits: {
          where: { status: { in: ["EARNED", "PAID"] } },
          select: {
            id: true,
            cutPercent: true,
            providerCutCad: true,
          },
        },
      },
    }),
    getCadToUsdRate(),
  ]);

  const bases = await loadCadBases(
    users,
    options?.providedStatsByUserId ?? new Map()
  );

  for (const affiliateId of ids) {
    const baseResult = bases.get(affiliateId);
    const base = baseResult?.base ?? null;
    if (!base) {
      output.set(affiliateId, {
        eventCadById: new Map(),
        splitCadById: new Map(),
        stale: true,
        reason: "unavailable",
        upstreamCadBase: null,
      });
      continue;
    }

    const affiliateEvents = events.filter(
      (event) => event.affiliateId === affiliateId
    );
    const eventUpdates: ProviderCadUpdate[] = [];
    const splitUpdates: ProviderCadUpdate[] = [];
    const allocated = allocateCommissionCad(
      affiliateEvents.map((event) => ({
        id: event.id,
        currency: event.currency,
        fullAmount: event.fullAmount.toString(),
        providerFullAmountCad:
          event.providerFullAmountCad?.toString() ?? null,
        upstreamState: event.upstreamState,
        upstreamPaidAt: event.upstreamPaidAt,
        upstreamVoidedAt: event.upstreamVoidedAt,
      })),
      baseTotals(base),
      { cadToUsdRate: exchangeRate?.rate ?? null }
    );
    const splitCadById = new Map<string, Decimal>();
    for (const event of affiliateEvents) {
      const eventCad = allocated.eventCad.get(event.id);
      const eventUsedFallback = allocated.fallbackEventIds.has(event.id);
      if (
        eventCad &&
        (event.providerFullAmountCad === null || eventUsedFallback)
      ) {
        eventUpdates.push({
          id: event.id,
          amountCad: eventCad,
          force: eventUsedFallback,
        });
      }
      for (const split of event.splits) {
        if (split.providerCutCad !== null && !eventUsedFallback) {
          splitCadById.set(
            split.id,
            new Decimal(split.providerCutCad.toString())
          );
          continue;
        }

        if (!eventCad) continue;

        const splitCad = allocateCutCad(eventCad, split.cutPercent.toString());
        splitCadById.set(split.id, splitCad);
        splitUpdates.push({
          id: split.id,
          amountCad: splitCad,
          force: eventUsedFallback,
        });
      }
    }

    try {
      await persistProviderCadUpdates({
        events: eventUpdates,
        splits: splitUpdates,
      });
    } catch (error) {
      console.error("[commission-cad] failed to freeze provider CAD amounts:", error);
    }

    const allocationUnavailable = allocated.unavailableStates.size > 0;
    output.set(affiliateId, {
      eventCadById: allocated.eventCad,
      splitCadById,
      stale: Boolean(baseResult?.stale) || allocationUnavailable,
      reason: allocationUnavailable
        ? "unavailable"
        : baseResult?.stale
          ? "stale"
          : "ok",
      upstreamCadBase: base,
    });
  }

  return output;
}

export async function getCommissionCadAllocation(
  affiliateId: string,
  options?: {
    providedStats?: rewardful.AffiliateLifetimeStats;
  }
): Promise<AffiliateCadAllocation> {
  const providedStatsByUserId = new Map<string, rewardful.AffiliateLifetimeStats>();
  if (options?.providedStats) {
    providedStatsByUserId.set(affiliateId, options.providedStats);
  }
  const allocations = await getCommissionCadAllocations([affiliateId], {
    providedStatsByUserId,
  });
  return (
    allocations.get(affiliateId) ?? {
      eventCadById: new Map(),
      splitCadById: new Map(),
      stale: true,
      reason: "unavailable",
      upstreamCadBase: null,
    }
  );
}
