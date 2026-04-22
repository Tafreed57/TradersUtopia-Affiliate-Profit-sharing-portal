import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";

import { linkRewardfulAffiliateWithTimeout } from "@/lib/auth-rewardful-link";
import { getCadToUsdRate } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import * as rewardful from "@/lib/rewardful";
import { getTeacherRelationshipEpisodeSummary } from "@/lib/teacher-student-relationships";

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 7;
const VALID_COMMISSION_STATUSES = [
  "EARNED",
  "FORFEITED",
  "PENDING",
  "PAID",
  "VOIDED",
] as const;

type ValidCommissionStatus = (typeof VALID_COMMISSION_STATUSES)[number];

interface LifetimeStatsPayload {
  visitors: number;
  leads: number;
  conversions: number;
  conversionRate: number;
  grossEarnedCad: number;
  paidCad: number;
  unpaidCad: number;
  dueCad: number;
  pendingCad: number;
  currency: "USD" | "CAD";
  coupons: Array<{ id: string; code: string }>;
  nextDueAt: string | null;
  campaign: {
    id: string;
    name: string;
    rewardType: "percent" | "amount";
    commissionPercent: number | null;
    commissionAmountCents: number | null;
    commissionAmountCurrency: string | null;
    daysUntilCommissionsAreDue: number | null;
    minimumPayoutCents: number | null;
    minimumPayoutCurrency: string | null;
  } | null;
  fetchedAt: string;
  cachedAt?: string;
  stale?: boolean;
}

interface CacheRecord extends LifetimeStatsPayload {
  cacheVersion: number;
}

export class AffiliatePortalDataError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AffiliatePortalDataError";
    this.status = status;
  }
}

export interface CommissionQueryInput {
  page: number;
  limit: number;
  status?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface AttendanceQueryInput {
  page: number;
  limit: number;
  from?: string | null;
  to?: string | null;
}

function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100;
}

function toIsoString(value: Date | null) {
  return value ? value.toISOString() : null;
}

function startOfUtcDay(dateStr: string) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function endOfUtcDay(dateStr: string) {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

function toCad(nativeAmount: number, currency: string, cadToUsd: number) {
  return currency.toUpperCase() === "CAD"
    ? nativeAmount
    : nativeAmount / cadToUsd;
}

function normalizeCommissionStatus(status?: string | null) {
  if (!status) return undefined;
  return VALID_COMMISSION_STATUSES.includes(status as ValidCommissionStatus)
    ? (status as ValidCommissionStatus)
    : undefined;
}

export async function getAffiliateCommissionsData(
  userId: string,
  input: CommissionQueryInput
) {
  const where: Prisma.CommissionSplitWhereInput = {
    role: "AFFILIATE",
    recipientId: userId,
  };

  const normalizedStatus = normalizeCommissionStatus(input.status);
  if (normalizedStatus) {
    where.status = normalizedStatus;
  }

  if (input.from || input.to) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (input.from) dateFilter.gte = startOfUtcDay(input.from);
    if (input.to) dateFilter.lte = endOfUtcDay(input.to);
    where.event = { conversionDate: dateFilter };
  }

  const [splits, total] = await Promise.all([
    prisma.commissionSplit.findMany({
      where,
      orderBy: { event: { conversionDate: "desc" } },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: {
        id: true,
        cutAmount: true,
        status: true,
        forfeitedToCeo: true,
        forfeitureReason: true,
        createdAt: true,
        event: {
          select: {
            conversionDate: true,
            currency: true,
            upstreamState: true,
            upstreamDueAt: true,
            campaignName: true,
          },
        },
      },
    }),
    prisma.commissionSplit.count({ where }),
  ]);

  return {
    data: splits.map((split) => ({
      id: split.id,
      affiliateCut: split.cutAmount.toString(),
      currency: split.event.currency.toUpperCase() as "USD" | "CAD",
      status: split.status,
      forfeitedToCeo: split.forfeitedToCeo,
      forfeitureReason: split.forfeitureReason,
      conversionDate: split.event.conversionDate.toISOString(),
      upstreamState: split.event.upstreamState,
      upstreamDueAt: toIsoString(split.event.upstreamDueAt),
      campaignName: split.event.campaignName,
      processedAt: split.createdAt.toISOString(),
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}

export async function getAffiliateAttendanceData(
  userId: string,
  input: AttendanceQueryInput
) {
  const where: Prisma.AttendanceWhereInput = { userId };

  if (input.from || input.to) {
    const dateFilter: Prisma.StringFilter = {};
    if (input.from) dateFilter.gte = input.from;
    if (input.to) dateFilter.lte = input.to;
    where.date = dateFilter;
  }

  const [records, total, allTimeCount] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: {
        id: true,
        date: true,
        timezone: true,
        note: true,
        submittedAt: true,
      },
    }),
    prisma.attendance.count({ where }),
    prisma.attendance.count({ where: { userId } }),
  ]);

  return {
    data: records.map((record) => ({
      id: record.id,
      date: record.date,
      timezone: record.timezone,
      note: record.note,
      submittedAt: record.submittedAt.toISOString(),
    })),
    hasEverSubmitted: allTimeCount > 0,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}

export async function getAffiliateLifetimeStatsData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      rewardfulAffiliateId: true,
      lifetimeStatsJson: true,
      lifetimeStatsCachedAt: true,
    },
  });

  if (!user) {
    throw new AffiliatePortalDataError(404, "User not found");
  }

  if (!user.rewardfulAffiliateId) {
    throw new AffiliatePortalDataError(409, "Account not yet linked");
  }

  const cachedRecord = user.lifetimeStatsJson as unknown as CacheRecord | null;
  const cachedFresh =
    cachedRecord &&
    cachedRecord.cacheVersion === CACHE_VERSION &&
    user.lifetimeStatsCachedAt &&
    Date.now() - user.lifetimeStatsCachedAt.getTime() < CACHE_TTL_MS;

  if (cachedFresh) {
    return {
      ...cachedRecord,
      cachedAt: user.lifetimeStatsCachedAt?.toISOString(),
      stale: false,
    };
  }

  const affiliateSplitWhere = {
    role: "AFFILIATE" as const,
    recipientId: userId,
  };

  try {
    const [stats, splits, rate] = await Promise.all([
      rewardful.getAffiliateLifetimeStats(user.rewardfulAffiliateId),
      prisma.commissionSplit.findMany({
        where: {
          ...affiliateSplitWhere,
          status: { in: ["EARNED", "PAID"] },
        },
        select: {
          cutAmount: true,
          status: true,
          event: {
            select: {
              currency: true,
              upstreamState: true,
              upstreamDueAt: true,
            },
          },
        },
      }),
      getCadToUsdRate(),
    ]);

    const cadToUsd = rate?.rate.toNumber() ?? 0.74;
    let paidCad = 0;
    let dueCad = 0;
    let pendingCad = 0;
    let nextDueAt: Date | null = null;

    for (const split of splits) {
      const cad = toCad(
        split.cutAmount.toNumber(),
        split.event.currency,
        cadToUsd
      );

      if (split.status === "PAID") {
        paidCad += cad;
        continue;
      }

      if (split.event.upstreamState === "due") {
        dueCad += cad;
      } else {
        pendingCad += cad;
      }

      if (
        split.event.upstreamDueAt &&
        split.event.upstreamState !== "due" &&
        (!nextDueAt || split.event.upstreamDueAt < nextDueAt)
      ) {
        nextDueAt = split.event.upstreamDueAt;
      }
    }

    paidCad = roundMoney(paidCad);
    dueCad = roundMoney(dueCad);
    pendingCad = roundMoney(pendingCad);
    const unpaidCad = roundMoney(dueCad + pendingCad);
    const grossEarnedCad = roundMoney(unpaidCad + paidCad);

    let campaign: LifetimeStatsPayload["campaign"] = null;
    if (stats.campaignId) {
      const campaigns = await rewardful.listAllCampaigns();
      const matched = campaigns.find((candidate) => candidate.id === stats.campaignId);
      if (matched) {
        campaign = {
          id: matched.id,
          name: matched.name,
          rewardType: matched.reward_type,
          commissionPercent:
            matched.reward_type === "percent"
              ? matched.commission_percent ?? null
              : null,
          commissionAmountCents: matched.commission_amount_cents ?? null,
          commissionAmountCurrency:
            matched.commission_amount_currency ?? null,
          daysUntilCommissionsAreDue:
            matched.days_until_commissions_are_due ?? null,
          minimumPayoutCents: matched.minimum_payout_cents ?? null,
          minimumPayoutCurrency: matched.minimum_payout_currency ?? null,
        };
      }
    }

    const payload: LifetimeStatsPayload = {
      visitors: stats.visitors,
      leads: stats.leads,
      conversions: stats.conversions,
      conversionRate: stats.conversionRate,
      grossEarnedCad,
      paidCad,
      unpaidCad,
      dueCad,
      pendingCad,
      currency: "CAD",
      coupons: stats.coupons,
      nextDueAt: nextDueAt?.toISOString() ?? null,
      campaign,
      fetchedAt: stats.fetchedAt,
    };

    const cacheRecord: CacheRecord = {
      ...payload,
      cacheVersion: CACHE_VERSION,
    };

    await prisma.user.update({
      where: { id: userId },
      data: {
        lifetimeStatsJson: cacheRecord as unknown as object,
        lifetimeStatsCachedAt: new Date(),
      },
    });

    return {
      ...payload,
      cachedAt: new Date().toISOString(),
      stale: false,
    };
  } catch (error) {
    const isMissingAffiliate =
      error instanceof Error && /404/.test(error.message);

    if (isMissingAffiliate) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          rewardfulAffiliateId: null,
          rewardfulEmail: null,
          backfillStatus: "NOT_STARTED",
          lifetimeStatsJson: Prisma.DbNull,
          lifetimeStatsCachedAt: null,
        },
      });

      if (user.email) {
        await linkRewardfulAffiliateWithTimeout({
          userId,
          email: user.email,
          name: user.name,
        });
      }

      throw new AffiliatePortalDataError(409, "Account re-linked, please refresh");
    }

    console.error(`[lifetime-stats] fetch failed for ${userId}:`, error);

    if (cachedRecord?.cacheVersion === CACHE_VERSION) {
      return {
        ...cachedRecord,
        cachedAt: user.lifetimeStatsCachedAt?.toISOString(),
        stale: true,
      };
    }

    throw new AffiliatePortalDataError(503, "Stats temporarily unavailable");
  }
}

function teacherEpisodeKey(relationshipId: string, relationshipSequence: number) {
  return `${relationshipId}:${relationshipSequence}`;
}

function emptyTeacherEpisodeSummary() {
  return {
    paid: new Decimal(0),
    unpaid: new Decimal(0),
    due: new Decimal(0),
    pending: new Decimal(0),
    count: 0,
    nextDueAt: null as Date | null,
  };
}

async function getTeacherEpisodeSummaries(
  teacherId: string,
  episodes: Array<{ relationshipId: string; relationshipSequence: number }>
) {
  const uniqueEpisodes = Array.from(
    new Map(
      episodes.map((episode) => [
        teacherEpisodeKey(episode.relationshipId, episode.relationshipSequence),
        episode,
      ])
    ).values()
  );
  const summaryByKey = new Map(
    uniqueEpisodes.map((episode) => [
      teacherEpisodeKey(episode.relationshipId, episode.relationshipSequence),
      emptyTeacherEpisodeSummary(),
    ])
  );

  if (uniqueEpisodes.length === 0) {
    return summaryByKey;
  }

  const [splits, rate] = await Promise.all([
    prisma.commissionSplit.findMany({
      where: {
        role: "TEACHER",
        recipientId: teacherId,
        teacherStudentId: {
          in: uniqueEpisodes.map((episode) => episode.relationshipId),
        },
        status: { in: ["EARNED", "PAID"] },
      },
      select: {
        teacherStudentId: true,
        teacherStudentSequence: true,
        cutAmount: true,
        status: true,
        event: {
          select: {
            currency: true,
            upstreamState: true,
            upstreamDueAt: true,
          },
        },
      },
    }),
    getCadToUsdRate(),
  ]);

  const cadToUsd = new Decimal(rate?.rate.toString() ?? "0.74");
  const allowedKeys = new Set(summaryByKey.keys());

  for (const split of splits) {
    if (!split.teacherStudentId || split.teacherStudentSequence === null) {
      continue;
    }

    const key = teacherEpisodeKey(
      split.teacherStudentId,
      split.teacherStudentSequence
    );
    if (!allowedKeys.has(key)) {
      continue;
    }

    const summary = summaryByKey.get(key);
    if (!summary) {
      continue;
    }

    const cad =
      split.event.currency === "CAD"
        ? new Decimal(split.cutAmount.toString())
        : new Decimal(split.cutAmount.toString()).div(cadToUsd);

    summary.count += 1;
    if (split.status === "PAID") {
      summary.paid = summary.paid.add(cad);
      continue;
    }

    summary.unpaid = summary.unpaid.add(cad);
    if (split.event.upstreamState === "due") {
      summary.due = summary.due.add(cad);
    } else {
      summary.pending = summary.pending.add(cad);
      if (
        split.event.upstreamDueAt &&
        (!summary.nextDueAt || split.event.upstreamDueAt < summary.nextDueAt)
      ) {
        summary.nextDueAt = split.event.upstreamDueAt;
      }
    }
  }

  return summaryByKey;
}

export async function getTeacherStudentsData(teacherId: string) {
  const me = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { canBeTeacher: true, canProposeRates: true },
  });

  if (!me) {
    throw new AffiliatePortalDataError(404, "User not found");
  }

  const [relationships, archivedRelationships] = await Promise.all([
    prisma.teacherStudent.findMany({
      where: { teacherId, status: "ACTIVE" },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            commissionPercent: true,
            initialCommissionPercent: true,
            recurringCommissionPercent: true,
            status: true,
          },
        },
      },
      orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
    }),
    prisma.teacherStudentArchive.findMany({
      where: { teacherId, showInPreviousStudents: true },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            commissionPercent: true,
            initialCommissionPercent: true,
            recurringCommissionPercent: true,
            status: true,
          },
        },
        restoreRequests: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, createdAt: true, requestNote: true },
        },
      },
      orderBy: { archivedAt: "desc" },
    }),
  ]);

  if (relationships.length === 0 && archivedRelationships.length === 0) {
    return {
      isTeacher: false,
      hasArchivedStudents: false,
      canBeTeacher: me.canBeTeacher,
      canProposeRates: me.canProposeRates,
      grandTotals: {
        totalUnpaidCad: 0,
        totalDueCad: 0,
        totalPendingCad: 0,
        directUnpaidCad: 0,
        indirectUnpaidCad: 0,
        archivedUnpaidCad: 0,
        activeUnpaidCad: 0,
        totalPaidCad: 0,
        archivedPaidCad: 0,
      },
      directStudents: [],
      orphanedSubStudents: [],
      previousStudents: [],
    };
  }

  const directRelationships = relationships.filter(
    (relationship) => relationship.depth === 1
  );
  const depthTwoRelationships = relationships.filter(
    (relationship) => relationship.depth === 2
  );
  const directStudentIds = directRelationships.map(
    (relationship) => relationship.studentId
  );
  const depthTwoStudentIds = depthTwoRelationships.map(
    (relationship) => relationship.studentId
  );
  const archivedStudentIds = archivedRelationships.map(
    (relationship) => relationship.studentId
  );
  const allStudentIds = Array.from(
    new Set([...directStudentIds, ...depthTwoStudentIds, ...archivedStudentIds])
  );

  const parentByDepthTwoStudent = new Map<string, string>();
  if (depthTwoStudentIds.length > 0 && directStudentIds.length > 0) {
    const parentLinks = await prisma.teacherStudent.findMany({
      where: {
        teacherId: { in: directStudentIds },
        studentId: { in: depthTwoStudentIds },
        status: "ACTIVE",
        depth: 1,
      },
      select: { teacherId: true, studentId: true },
    });

    for (const link of parentLinks) {
      parentByDepthTwoStudent.set(link.studentId, link.teacherId);
    }
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);

  const [summaryByEpisode, attendanceSummaries] = await Promise.all([
    getTeacherEpisodeSummaries(teacherId, [
      ...relationships.map((relationship) => ({
        relationshipId: relationship.id,
        relationshipSequence: relationship.activationSequence,
      })),
      ...archivedRelationships.map((archive) => ({
        relationshipId: archive.teacherStudentId,
        relationshipSequence: archive.activationSequence,
      })),
    ]),
    prisma.attendance.groupBy({
      by: ["userId"],
      where: {
        userId: { in: allStudentIds },
        date: { gte: monthStartStr, lte: monthEndStr },
      },
      _count: true,
    }),
  ]);

  const attendanceMap = new Map(
    attendanceSummaries.map((summary) => [summary.userId, summary._count])
  );
  const fetchedAt = new Date().toISOString();

  function buildActiveStudent(relationship: (typeof relationships)[number]) {
    const summary =
      summaryByEpisode.get(
        teacherEpisodeKey(relationship.id, relationship.activationSequence)
      ) ?? emptyTeacherEpisodeSummary();

    return {
      relationshipId: relationship.id,
      relationshipSequence: relationship.activationSequence,
      id: relationship.student.id,
      name: relationship.student.name,
      email: relationship.student.email,
      image: relationship.student.image,
      commissionPercent: relationship.student.commissionPercent.toNumber(),
      initialCommissionPercent:
        relationship.student.initialCommissionPercent.toNumber(),
      recurringCommissionPercent:
        relationship.student.recurringCommissionPercent.toNumber(),
      status: relationship.student.status,
      depth: relationship.depth,
      teacherCutPercent: relationship.teacherCut.toNumber(),
      teacherUnpaidCad: summary.unpaid.toDecimalPlaces(2).toNumber(),
      teacherDueCad: summary.due.toDecimalPlaces(2).toNumber(),
      teacherPendingCad: summary.pending.toDecimalPlaces(2).toNumber(),
      teacherPaidCad: summary.paid.toDecimalPlaces(2).toNumber(),
      nextDueAt: summary.nextDueAt?.toISOString() ?? null,
      conversionCount: summary.count,
      attendanceDaysThisMonth: attendanceMap.get(relationship.studentId) ?? 0,
      dataStale: false,
      dataReason: "ok" as const,
      fetchedAt,
    };
  }

  type BuiltStudent = ReturnType<typeof buildActiveStudent>;

  const subStudentsByParent = new Map<string, BuiltStudent[]>();
  const orphanedSubStudents: BuiltStudent[] = [];

  for (const relationship of depthTwoRelationships) {
    const parent = parentByDepthTwoStudent.get(relationship.studentId);
    const builtStudent = buildActiveStudent(relationship);

    if (!parent) {
      console.warn(
        `[getTeacherStudentsData] orphaned depth-2 relationship: teacher=${teacherId} student=${relationship.studentId}`
      );
      orphanedSubStudents.push(builtStudent);
      continue;
    }

    const existing = subStudentsByParent.get(parent) ?? [];
    existing.push(builtStudent);
    subStudentsByParent.set(parent, existing);
  }

  const directStudents = directRelationships.map((relationship) => ({
    ...buildActiveStudent(relationship),
    subStudents: subStudentsByParent.get(relationship.studentId) ?? [],
  }));

  const previousStudents = archivedRelationships.map((archive) => {
    const summary =
      summaryByEpisode.get(
        teacherEpisodeKey(archive.teacherStudentId, archive.activationSequence)
      ) ?? emptyTeacherEpisodeSummary();

    return {
      archiveId: archive.id,
      relationshipId: archive.teacherStudentId,
      relationshipSequence: archive.activationSequence,
      id: archive.student.id,
      name: archive.student.name,
      email: archive.student.email,
      image: archive.student.image,
      commissionPercent: archive.student.commissionPercent.toNumber(),
      initialCommissionPercent:
        archive.student.initialCommissionPercent.toNumber(),
      recurringCommissionPercent:
        archive.student.recurringCommissionPercent.toNumber(),
      status: archive.student.status,
      depth: archive.depth,
      teacherCutPercent: archive.teacherCut.toNumber(),
      teacherUnpaidCad: summary.unpaid.toDecimalPlaces(2).toNumber(),
      teacherDueCad: summary.due.toDecimalPlaces(2).toNumber(),
      teacherPendingCad: summary.pending.toDecimalPlaces(2).toNumber(),
      teacherPaidCad: summary.paid.toDecimalPlaces(2).toNumber(),
      nextDueAt: summary.nextDueAt?.toISOString() ?? null,
      conversionCount: summary.count,
      attendanceDaysThisMonth: attendanceMap.get(archive.studentId) ?? 0,
      dataStale: false,
      dataReason: "ok" as const,
      fetchedAt,
      archivedAt: archive.archivedAt.toISOString(),
      archivedByRole: archive.archivedByRole,
      archiveReason: archive.archiveReason,
      snapshotUnpaidCad: archive.snapshotUnpaidCad.toNumber(),
      snapshotDueCad: archive.snapshotDueCad.toNumber(),
      snapshotPendingCad: archive.snapshotPendingCad.toNumber(),
      snapshotPaidCad: archive.snapshotPaidCad.toNumber(),
      snapshotCommissionCount: archive.snapshotCommissionCount,
      snapshotNextDueAt: archive.snapshotNextDueAt?.toISOString() ?? null,
      pendingRestoreRequest: archive.restoreRequests[0]
        ? {
            id: archive.restoreRequests[0].id,
            createdAt: archive.restoreRequests[0].createdAt.toISOString(),
            requestNote: archive.restoreRequests[0].requestNote,
          }
        : null,
    };
  });

  const directUnpaidCad = directStudents.reduce(
    (sum, student) => sum + student.teacherUnpaidCad,
    0
  );
  const indirectUnpaidCad =
    directStudents.reduce(
      (sum, student) =>
        sum +
        student.subStudents.reduce(
          (subTotal, subStudent) => subTotal + subStudent.teacherUnpaidCad,
          0
        ),
      0
    ) +
    orphanedSubStudents.reduce(
      (sum, student) => sum + student.teacherUnpaidCad,
      0
    );
  const archivedUnpaidCad = previousStudents.reduce(
    (sum, student) => sum + student.teacherUnpaidCad,
    0
  );
  const activeDueCad =
    directStudents.reduce(
      (sum, student) =>
        sum +
        student.teacherDueCad +
        student.subStudents.reduce(
          (subTotal, subStudent) => subTotal + subStudent.teacherDueCad,
          0
        ),
      0
    ) +
    orphanedSubStudents.reduce((sum, student) => sum + student.teacherDueCad, 0);
  const activePendingCad =
    directStudents.reduce(
      (sum, student) =>
        sum +
        student.teacherPendingCad +
        student.subStudents.reduce(
          (subTotal, subStudent) => subTotal + subStudent.teacherPendingCad,
          0
        ),
      0
    ) +
    orphanedSubStudents.reduce(
      (sum, student) => sum + student.teacherPendingCad,
      0
    );
  const archivedDueCad = previousStudents.reduce(
    (sum, student) => sum + student.teacherDueCad,
    0
  );
  const archivedPendingCad = previousStudents.reduce(
    (sum, student) => sum + student.teacherPendingCad,
    0
  );
  const activePaidCad =
    directStudents.reduce(
      (sum, student) =>
        sum +
        student.teacherPaidCad +
        student.subStudents.reduce(
          (subTotal, subStudent) => subTotal + subStudent.teacherPaidCad,
          0
        ),
      0
    ) +
    orphanedSubStudents.reduce(
      (sum, student) => sum + student.teacherPaidCad,
      0
    );
  const archivedPaidCad = previousStudents.reduce(
    (sum, student) => sum + student.teacherPaidCad,
    0
  );

  return {
    isTeacher: relationships.length > 0,
    hasArchivedStudents: previousStudents.length > 0,
    canBeTeacher: me.canBeTeacher,
    canProposeRates: me.canProposeRates,
    grandTotals: {
      totalUnpaidCad: roundMoney(
        directUnpaidCad + indirectUnpaidCad + archivedUnpaidCad
      ),
      totalDueCad: roundMoney(activeDueCad + archivedDueCad),
      totalPendingCad: roundMoney(activePendingCad + archivedPendingCad),
      directUnpaidCad: roundMoney(directUnpaidCad),
      indirectUnpaidCad: roundMoney(indirectUnpaidCad),
      archivedUnpaidCad: roundMoney(archivedUnpaidCad),
      activeUnpaidCad: roundMoney(directUnpaidCad + indirectUnpaidCad),
      totalPaidCad: roundMoney(activePaidCad + archivedPaidCad),
      archivedPaidCad: roundMoney(archivedPaidCad),
    },
    directStudents,
    orphanedSubStudents,
    previousStudents,
  };
}

export async function getTeacherStudentDetailData(
  teacherId: string,
  studentId: string,
  input?: {
    relationshipId?: string;
    relationshipSequence?: number;
  }
) {
  let relationshipContext:
    | {
        relationshipId: string;
        relationshipSequence: number;
        depth: number;
        teacherCut: Prisma.Decimal;
      }
    | undefined;

  if (input?.relationshipId && input.relationshipSequence) {
    const [relationship, archive] = await Promise.all([
      prisma.teacherStudent.findFirst({
        where: {
          id: input.relationshipId,
          teacherId,
          studentId,
        },
        select: {
          id: true,
          activationSequence: true,
          depth: true,
          teacherCut: true,
        },
      }),
      prisma.teacherStudentArchive.findFirst({
        where: {
          teacherStudentId: input.relationshipId,
          activationSequence: input.relationshipSequence,
          teacherId,
          studentId,
        },
        select: {
          teacherStudentId: true,
          activationSequence: true,
          depth: true,
          teacherCut: true,
        },
      }),
    ]);

    if (
      relationship &&
      relationship.activationSequence === input.relationshipSequence
    ) {
      relationshipContext = {
        relationshipId: relationship.id,
        relationshipSequence: relationship.activationSequence,
        depth: relationship.depth,
        teacherCut: relationship.teacherCut,
      };
    } else if (archive) {
      relationshipContext = {
        relationshipId: archive.teacherStudentId,
        relationshipSequence: archive.activationSequence,
        depth: archive.depth,
        teacherCut: archive.teacherCut,
      };
    }
  }

  if (!relationshipContext) {
    const activeRelationship = await prisma.teacherStudent.findFirst({
      where: { teacherId, studentId, status: "ACTIVE" },
      select: {
        id: true,
        activationSequence: true,
        depth: true,
        teacherCut: true,
      },
    });

    if (!activeRelationship) {
      throw new AffiliatePortalDataError(404, "Not found");
    }

    relationshipContext = {
      relationshipId: activeRelationship.id,
      relationshipSequence: activeRelationship.activationSequence,
      depth: activeRelationship.depth,
      teacherCut: activeRelationship.teacherCut,
    };
  }

  const COMMISSION_LIMIT = 200;
  const ATTENDANCE_LIMIT = 200;

  const splitWhere: Prisma.CommissionSplitWhereInput = {
    role: "TEACHER",
    recipientId: teacherId,
    teacherStudentId: relationshipContext.relationshipId,
    teacherStudentSequence: relationshipContext.relationshipSequence,
    status: { not: "PENDING" },
  };

  const [
    student,
    splits,
    attendance,
    teacherSplitStats,
    commissionTotal,
    attendanceTotal,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, email: true, image: true },
    }),
    prisma.commissionSplit.findMany({
      where: splitWhere,
      orderBy: { event: { conversionDate: "desc" } },
      take: COMMISSION_LIMIT,
      select: {
        id: true,
        cutPercent: true,
        cutAmount: true,
        status: true,
        forfeitedToCeo: true,
        forfeitureReason: true,
        paidAt: true,
        event: {
          select: {
            conversionDate: true,
            fullAmount: true,
            currency: true,
            upstreamState: true,
            upstreamDueAt: true,
            campaignName: true,
          },
        },
      },
    }),
    prisma.attendance.findMany({
      where: { userId: studentId },
      orderBy: { date: "desc" },
      take: ATTENDANCE_LIMIT,
      select: {
        id: true,
        date: true,
        timezone: true,
        note: true,
        submittedAt: true,
      },
    }),
    getTeacherRelationshipEpisodeSummary(
      teacherId,
      relationshipContext.relationshipId,
      relationshipContext.relationshipSequence
    ),
    prisma.commissionSplit.count({ where: splitWhere }),
    prisma.attendance.count({ where: { userId: studentId } }),
  ]);

  if (!student) {
    throw new AffiliatePortalDataError(404, "Not found");
  }

  return {
    student,
    relationshipId: relationshipContext.relationshipId,
    relationshipSequence: relationshipContext.relationshipSequence,
    depth: relationshipContext.depth,
    teacherCutPercent: relationshipContext.teacherCut.toNumber(),
    teacherUnpaidCad: teacherSplitStats.teacherUnpaidCad,
    teacherDueCad: teacherSplitStats.teacherDueCad,
    teacherPendingCad: teacherSplitStats.teacherPendingCad,
    teacherPaidCad: teacherSplitStats.teacherPaidCad,
    nextDueAt: teacherSplitStats.nextDueAt,
    dataStale: false,
    dataReason: "ok",
    fetchedAt: new Date().toISOString(),
    commissionTotal,
    attendanceTotal,
    commissionHasMore: commissionTotal > splits.length,
    attendanceHasMore: attendanceTotal > attendance.length,
    commissions: splits.map((split) => ({
      id: split.id,
      conversionDate: split.event.conversionDate.toISOString(),
      fullAmount: split.event.fullAmount.toNumber(),
      teacherCutPercent: split.cutPercent.toNumber(),
      teacherCut: split.cutAmount.toNumber(),
      currency: split.event.currency.toUpperCase() as "USD" | "CAD",
      status: split.status,
      forfeitedToCeo: split.forfeitedToCeo,
      forfeitureReason: split.forfeitureReason,
      paidAt: toIsoString(split.paidAt),
      upstreamState: split.event.upstreamState,
      upstreamDueAt: toIsoString(split.event.upstreamDueAt),
      campaignName: split.event.campaignName,
    })),
    attendance: attendance.map((record) => ({
      id: record.id,
      date: record.date,
      timezone: record.timezone,
      note: record.note,
      submittedAt: record.submittedAt.toISOString(),
    })),
  };
}

export async function getAffiliateEarnedSummaryCad(userId: string) {
  const affiliateSplitWhere = { role: "AFFILIATE" as const, recipientId: userId };
  const [earnedUsdAgg, earnedCadAgg, paidUsdAgg, paidCadAgg, rate] =
    await Promise.all([
      prisma.commissionSplit.aggregate({
        where: { ...affiliateSplitWhere, status: "EARNED", event: { currency: "USD" } },
        _sum: { cutAmount: true },
      }),
      prisma.commissionSplit.aggregate({
        where: { ...affiliateSplitWhere, status: "EARNED", event: { currency: "CAD" } },
        _sum: { cutAmount: true },
      }),
      prisma.commissionSplit.aggregate({
        where: { ...affiliateSplitWhere, status: "PAID", event: { currency: "USD" } },
        _sum: { cutAmount: true },
      }),
      prisma.commissionSplit.aggregate({
        where: { ...affiliateSplitWhere, status: "PAID", event: { currency: "CAD" } },
        _sum: { cutAmount: true },
      }),
      getCadToUsdRate(),
    ]);

  const cadToUsd = rate?.rate.toNumber() ?? 0.74;
  const earnedCad = roundMoney(
    (earnedCadAgg._sum.cutAmount?.toNumber() ?? 0) +
      toCad(earnedUsdAgg._sum.cutAmount?.toNumber() ?? 0, "USD", cadToUsd)
  );
  const paidCad = roundMoney(
    (paidCadAgg._sum.cutAmount?.toNumber() ?? 0) +
      toCad(paidUsdAgg._sum.cutAmount?.toNumber() ?? 0, "USD", cadToUsd)
  );

  return {
    earnedCad,
    paidCad,
    totalCad: roundMoney(earnedCad + paidCad),
  };
}
