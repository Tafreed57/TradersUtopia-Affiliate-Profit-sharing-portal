import { clearLifetimeStatsCacheForUsers } from "@/lib/commission-cache";
import { prisma } from "@/lib/prisma";
import { listCommissions, type RewardfulCommission } from "@/lib/rewardful";

const AFFILIATE_SYNC_MAX_PAGES = 50;
const GLOBAL_SYNC_MAX_PAGES = 200;

interface PaidEntry {
  rewardfulCommissionId: string;
  paidAt: string;
}

interface VoidedEntry {
  rewardfulCommissionId: string;
  voidedAt: string;
}

type CommissionStateSnapshot = Pick<
  RewardfulCommission,
  "id" | "state" | "due_at" | "paid_at" | "voided_at" | "campaign"
>;

function chunk<T>(items: T[], size: number): T[][]
{
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function applyEventSnapshots(
  commissions: CommissionStateSnapshot[]
): Promise<{ updated: number; affiliateIds: string[] }> {
  if (commissions.length === 0) {
    return { updated: 0, affiliateIds: [] };
  }

  const ids = [...new Set(commissions.map((commission) => commission.id))];
  const events = await prisma.commissionEvent.findMany({
    where: { rewardfulCommissionId: { in: ids } },
    select: { rewardfulCommissionId: true, affiliateId: true },
  });
  if (events.length === 0) {
    return { updated: 0, affiliateIds: [] };
  }

  const affiliateIds = [...new Set(events.map((event) => event.affiliateId))];
  const knownIds = new Set(events.map((event) => event.rewardfulCommissionId));
  const ops = commissions
    .filter((commission) => knownIds.has(commission.id))
    .map((commission) =>
      prisma.commissionEvent.updateMany({
        where: { rewardfulCommissionId: commission.id },
        data: {
          upstreamState: commission.state ?? null,
          upstreamDueAt: commission.due_at ? new Date(commission.due_at) : null,
          upstreamPaidAt: commission.paid_at ? new Date(commission.paid_at) : null,
          upstreamVoidedAt: commission.voided_at
            ? new Date(commission.voided_at)
            : null,
          campaignId: commission.campaign?.id || null,
          campaignName: commission.campaign?.name || null,
        },
      })
    );

  let updated = 0;
  for (const batch of chunk(ops, 100)) {
    const result = await prisma.$transaction(batch);
    updated += result.reduce((sum, item) => sum + item.count, 0);
  }

  return { updated, affiliateIds };
}

function toPaidEntries(
  commissions: CommissionStateSnapshot[]
): PaidEntry[] {
  return commissions.flatMap((commission) => {
    if (commission.state !== "paid" || !commission.paid_at) return [];
    return [
      {
        rewardfulCommissionId: commission.id,
        paidAt: commission.paid_at,
      },
    ];
  });
}

function toVoidedEntries(
  commissions: CommissionStateSnapshot[]
): VoidedEntry[] {
  return commissions.flatMap((commission) => {
    if (commission.state !== "voided" || !commission.voided_at) return [];
    return [
      {
        rewardfulCommissionId: commission.id,
        voidedAt: commission.voided_at,
      },
    ];
  });
}

async function applyPaidEntries(
  entries: PaidEntry[]
): Promise<{ updated: number }> {
  if (entries.length === 0) {
    return { updated: 0 };
  }

  const byPaidAt = new Map<string, string[]>();
  for (const entry of entries) {
    const rcids = byPaidAt.get(entry.paidAt) ?? [];
    rcids.push(entry.rewardfulCommissionId);
    byPaidAt.set(entry.paidAt, rcids);
  }

  let updated = 0;
  const affectedAffiliateIds = new Set<string>();

  for (const [paidAtStr, rewardfulCommissionIds] of byPaidAt) {
    const events = await prisma.commissionEvent.findMany({
      where: { rewardfulCommissionId: { in: rewardfulCommissionIds } },
      select: { id: true, affiliateId: true },
    });
    if (events.length === 0) continue;

    for (const event of events) {
      affectedAffiliateIds.add(event.affiliateId);
    }

    const result = await prisma.commissionSplit.updateMany({
      where: {
        eventId: { in: events.map((event) => event.id) },
        status: "EARNED",
      },
      data: {
        status: "PAID",
        paidAt: new Date(paidAtStr),
      },
    });
    updated += result.count;
    await prisma.commissionEvent.updateMany({
      where: { id: { in: events.map((event) => event.id) } },
      data: {
        upstreamState: "paid",
        upstreamPaidAt: new Date(paidAtStr),
      },
    });
  }

  if (updated > 0) {
    await clearLifetimeStatsCacheForUsers([...affectedAffiliateIds]);
  }

  return { updated };
}

async function applyVoidedEntries(
  entries: VoidedEntry[]
): Promise<{ updated: number }> {
  if (entries.length === 0) {
    return { updated: 0 };
  }

  const byVoidedAt = new Map<string, string[]>();
  for (const entry of entries) {
    const rcids = byVoidedAt.get(entry.voidedAt) ?? [];
    rcids.push(entry.rewardfulCommissionId);
    byVoidedAt.set(entry.voidedAt, rcids);
  }

  let updated = 0;
  const affectedAffiliateIds = new Set<string>();

  for (const [voidedAtStr, rewardfulCommissionIds] of byVoidedAt) {
    const events = await prisma.commissionEvent.findMany({
      where: { rewardfulCommissionId: { in: rewardfulCommissionIds } },
      select: { id: true, affiliateId: true },
    });
    if (events.length === 0) continue;

    for (const event of events) {
      affectedAffiliateIds.add(event.affiliateId);
    }

    const result = await prisma.commissionSplit.updateMany({
      where: {
        eventId: { in: events.map((event) => event.id) },
        status: { not: "VOIDED" },
      },
      data: {
        status: "VOIDED",
        voidedAt: new Date(voidedAtStr),
      },
    });
    updated += result.count;
    await prisma.commissionEvent.updateMany({
      where: { id: { in: events.map((event) => event.id) } },
      data: {
        upstreamState: "voided",
        upstreamVoidedAt: new Date(voidedAtStr),
      },
    });
  }

  if (updated > 0) {
    await clearLifetimeStatsCacheForUsers([...affectedAffiliateIds]);
  }

  return { updated };
}

export async function syncCommissionStatesFromCommissions(
  commissions: CommissionStateSnapshot[]
): Promise<{
  snapshotUpdated: number;
  paidFetched: number;
  paidUpdated: number;
  voidedFetched: number;
  voidedUpdated: number;
}> {
  const { updated: snapshotUpdated, affiliateIds } = await applyEventSnapshots(
    commissions
  );
  const paidEntries = toPaidEntries(commissions);
  const voidedEntries = toVoidedEntries(commissions);
  const { updated: paidUpdated } = await applyPaidEntries(paidEntries);
  const { updated: voidedUpdated } = await applyVoidedEntries(voidedEntries);

  if (snapshotUpdated > 0 && paidUpdated === 0 && voidedUpdated === 0) {
    await clearLifetimeStatsCacheForUsers(affiliateIds);
  }

  return {
    snapshotUpdated,
    paidFetched: paidEntries.length,
    paidUpdated,
    voidedFetched: voidedEntries.length,
    voidedUpdated,
  };
}

export async function syncPaidHistoryFromCommissions(
  commissions: CommissionStateSnapshot[]
): Promise<{ fetched: number; updated: number }> {
  const { paidFetched, paidUpdated } = await syncCommissionStatesFromCommissions(
    commissions
  );
  return { fetched: paidFetched, updated: paidUpdated };
}

export async function syncCommissionMissingUpstream(
  rewardfulCommissionId: string,
  voidedAt: Date
): Promise<number> {
  const { updated } = await applyVoidedEntries([
    {
      rewardfulCommissionId,
      voidedAt: voidedAt.toISOString(),
    },
  ]);
  return updated;
}

export async function syncPaidHistoryForAffiliate(
  rewardfulAffiliateId: string,
  maxPages = AFFILIATE_SYNC_MAX_PAGES
): Promise<{ fetched: number; updated: number }> {
  let fetched = 0;
  const entries: PaidEntry[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const response = await listCommissions({
      state: "paid",
      limit: 100,
      page,
      affiliate_id: rewardfulAffiliateId,
    });
    const items = response.data ?? [];
    fetched += items.length;
    entries.push(...toPaidEntries(items));

    if (!response.pagination.next_page) break;
  }

  const { updated } = await applyPaidEntries(entries);
  return { fetched, updated };
}

export async function syncPaidHistoryGlobally(
  maxPages = GLOBAL_SYNC_MAX_PAGES
): Promise<{ fetched: number; updated: number }> {
  let fetched = 0;
  const entries: PaidEntry[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const response = await listCommissions({
      state: "paid",
      limit: 100,
      page,
    });
    const items = response.data ?? [];
    fetched += items.length;
    entries.push(...toPaidEntries(items));

    if (!response.pagination.next_page) break;
  }

  const { updated } = await applyPaidEntries(entries);
  return { fetched, updated };
}
