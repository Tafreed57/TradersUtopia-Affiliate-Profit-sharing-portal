import {
  Prisma,
  TeacherStudentArchiveActorRole,
  TeacherStudentBackfillMode,
  TeacherStudentRestoreStatus,
  type TeacherStudent,
} from "@prisma/client";
import Decimal from "decimal.js";

import { getCadToUsdRate } from "@/lib/currency";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient | typeof prisma;

type TeacherStudentRecord = Pick<
  TeacherStudent,
  | "id"
  | "teacherId"
  | "studentId"
  | "depth"
  | "teacherCut"
  | "status"
  | "createdVia"
  | "activationSequence"
  | "activatedAt"
  | "deactivatedAt"
>;

export interface RelationshipEpisodeSummary {
  teacherUnpaidCad: number;
  teacherDueCad: number;
  teacherPendingCad: number;
  teacherPaidCad: number;
  nextDueAt: string | null;
  commissionCount: number;
}

export interface RestoreGapCommissionPreview {
  eventId: string;
  rewardfulCommissionId: string | null;
  conversionDate: string;
  campaignName: string | null;
  currency: "CAD" | "USD";
  currentState: "DUE_NOW" | "IN_HOLDING" | "PAID" | "VOIDED";
  releasesAt: string | null;
  paidAt: string | null;
  teacherCutPercent: number;
  grantAmountNative: number;
  grantAmountCad: number;
  canGrant: boolean;
  disabledReason: string | null;
}

export interface RestoreGapPreview {
  archiveId: string;
  relationshipId: string;
  teacherId: string;
  studentId: string;
  studentName: string | null;
  studentEmail: string;
  teacherName: string | null;
  teacherEmail: string;
  teacherCutPercent: number;
  archivedAt: string;
  archivedByRole: TeacherStudentArchiveActorRole;
  archiveReason: string | null;
  snapshot: {
    teacherUnpaidCad: number;
    teacherDueCad: number;
    teacherPendingCad: number;
    teacherPaidCad: number;
    nextDueAt: string | null;
    commissionCount: number;
  };
  gap: {
    totalCount: number;
    grantableCount: number;
    grantableCad: number;
    paidCad: number;
    dueCad: number;
    pendingCad: number;
  };
  commissions: RestoreGapCommissionPreview[];
  pendingRequest: {
    id: string;
    createdAt: string;
    requestNote: string | null;
    requestedById: string;
  } | null;
}

interface ArchiveRelationshipOptions {
  relationshipId: string;
  archivedById: string;
  archivedByRole: TeacherStudentArchiveActorRole;
  showInPreviousStudents?: boolean;
  archiveReason?: string | null;
}

interface ActivateRelationshipOptions {
  teacherId: string;
  studentId: string;
  actorId: string;
  origin?: "SELF_PROPOSAL" | "ADMIN_PAIR";
  teacherCut?: number;
  historicalBackfill?: "UNPAID_ONLY" | "NONE";
}

interface ReviewRestoreRequestOptions {
  requestId: string;
  reviewedById: string;
  action: "approve" | "reject";
  reviewNote?: string | null;
  backfillMode?: TeacherStudentBackfillMode;
  selectedEventIds?: string[];
}

interface DirectRestoreOptions {
  archiveId: string;
  reviewedById: string;
  reviewNote?: string | null;
  backfillMode: TeacherStudentBackfillMode;
  selectedEventIds?: string[];
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function toCad(nativeAmount: Decimal, currency: string, cadToUsd: Decimal) {
  return currency.toUpperCase() === "CAD"
    ? nativeAmount
    : nativeAmount.div(cadToUsd);
}

function getSplitStateLabel(event: {
  upstreamState: string | null;
  upstreamPaidAt: Date | null;
  upstreamVoidedAt: Date | null;
}) {
  if (event.upstreamVoidedAt || event.upstreamState === "voided") {
    return "VOIDED" as const;
  }
  if (event.upstreamPaidAt || event.upstreamState === "paid") {
    return "PAID" as const;
  }
  if (event.upstreamState === "due") {
    return "DUE_NOW" as const;
  }
  return "IN_HOLDING" as const;
}

async function getCadToUsdDecimal() {
  const rate = await getCadToUsdRate();
  return new Decimal(rate?.rate.toString() ?? "0.74");
}

async function getTeacherRelationshipEpisodeSummaryDb(
  db: DbClient,
  {
    teacherId,
    relationshipId,
    relationshipSequence,
    cadToUsd,
  }: {
    teacherId: string;
    relationshipId: string;
    relationshipSequence: number;
    cadToUsd: Decimal;
  }
): Promise<RelationshipEpisodeSummary> {
  const splits = await db.commissionSplit.findMany({
    where: {
      role: "TEACHER",
      recipientId: teacherId,
      teacherStudentId: relationshipId,
      teacherStudentSequence: relationshipSequence,
      status: { in: ["EARNED", "PAID"] },
    },
    select: {
      status: true,
      cutAmount: true,
      event: {
        select: {
          currency: true,
          upstreamState: true,
          upstreamDueAt: true,
        },
      },
    },
  });

  let teacherUnpaidCad = new Decimal(0);
  let teacherDueCad = new Decimal(0);
  let teacherPendingCad = new Decimal(0);
  let teacherPaidCad = new Decimal(0);
  let commissionCount = 0;
  let nextDueAt: Date | null = null;

  for (const split of splits) {
    const cad = toCad(
      new Decimal(split.cutAmount.toString()),
      split.event.currency,
      cadToUsd
    );

    commissionCount += 1;
    if (split.status === "PAID") {
      teacherPaidCad = teacherPaidCad.add(cad);
      continue;
    }

    teacherUnpaidCad = teacherUnpaidCad.add(cad);
    if (split.event.upstreamState === "due") {
      teacherDueCad = teacherDueCad.add(cad);
    } else {
      teacherPendingCad = teacherPendingCad.add(cad);
      if (
        split.event.upstreamDueAt &&
        (!nextDueAt || split.event.upstreamDueAt < nextDueAt)
      ) {
        nextDueAt = split.event.upstreamDueAt;
      }
    }
  }

  return {
    teacherUnpaidCad: roundMoney(teacherUnpaidCad.toNumber()),
    teacherDueCad: roundMoney(teacherDueCad.toNumber()),
    teacherPendingCad: roundMoney(teacherPendingCad.toNumber()),
    teacherPaidCad: roundMoney(teacherPaidCad.toNumber()),
    nextDueAt: nextDueAt?.toISOString() ?? null,
    commissionCount,
  };
}

async function createArchiveRecordTx(
  tx: DbClient,
  relationship: TeacherStudentRecord,
  {
    archivedById,
    archivedByRole,
    showInPreviousStudents,
    archiveReason,
    now,
    cadToUsd,
  }: {
    archivedById: string;
    archivedByRole: TeacherStudentArchiveActorRole;
    showInPreviousStudents: boolean;
    archiveReason: string | null;
    now: Date;
    cadToUsd: Decimal;
  }
) {
  const summary = await getTeacherRelationshipEpisodeSummaryDb(tx, {
    teacherId: relationship.teacherId,
    relationshipId: relationship.id,
    relationshipSequence: relationship.activationSequence,
    cadToUsd,
  });

  const data = {
    teacherStudentId: relationship.id,
    activationSequence: relationship.activationSequence,
    teacherId: relationship.teacherId,
    studentId: relationship.studentId,
    depth: relationship.depth,
    teacherCut: relationship.teacherCut,
    archivedAt: now,
    archivedById,
    archivedByRole,
    archiveReason,
    showInPreviousStudents,
    snapshotUnpaidCad: summary.teacherUnpaidCad,
    snapshotDueCad: summary.teacherDueCad,
    snapshotPendingCad: summary.teacherPendingCad,
    snapshotPaidCad: summary.teacherPaidCad,
    snapshotCommissionCount: summary.commissionCount,
    snapshotNextDueAt: summary.nextDueAt ? new Date(summary.nextDueAt) : null,
  };

  return tx.teacherStudentArchive.upsert({
    where: {
      teacherStudentId_activationSequence: {
        teacherStudentId: relationship.id,
        activationSequence: relationship.activationSequence,
      },
    },
    create: data,
    update: {
      teacherStudentId: relationship.id,
      activationSequence: relationship.activationSequence,
      teacherId: relationship.teacherId,
      studentId: relationship.studentId,
      depth: relationship.depth,
      teacherCut: relationship.teacherCut,
      archivedAt: now,
      archivedById,
      archivedByRole,
      archiveReason,
      showInPreviousStudents,
      snapshotUnpaidCad: summary.teacherUnpaidCad,
      snapshotDueCad: summary.teacherDueCad,
      snapshotPendingCad: summary.teacherPendingCad,
      snapshotPaidCad: summary.teacherPaidCad,
      snapshotCommissionCount: summary.commissionCount,
      snapshotNextDueAt: summary.nextDueAt ? new Date(summary.nextDueAt) : null,
    },
  });
}

async function createTeacherSplitForExistingEventTx(
  tx: DbClient,
  {
    event,
    teacherId,
    relationshipId,
    relationshipSequence,
    depth,
    teacherCutPercent,
    capToCeo = true,
  }: {
    event: {
      id: string;
      rewardfulCommissionId: string | null;
      fullAmount: Prisma.Decimal;
      ceoCut: Prisma.Decimal;
      currency: string;
      upstreamState: string | null;
      upstreamPaidAt: Date | null;
      upstreamVoidedAt: Date | null;
    };
    teacherId: string;
    relationshipId: string;
    relationshipSequence: number;
    depth: number;
    teacherCutPercent: Prisma.Decimal | Decimal | number;
    capToCeo?: boolean;
  }
) {
  if (event.upstreamVoidedAt || event.upstreamState === "voided") {
    return {
      created: false,
      cutNative: new Decimal(0),
      cutStatus: "VOIDED" as const,
    };
  }

  const fullAmount = new Decimal(event.fullAmount.toString());
  const ceoCut = new Decimal(event.ceoCut.toString());
  const cutPercent = new Decimal(teacherCutPercent.toString());
  const requestedCut = fullAmount.mul(cutPercent).div(100).toDecimalPlaces(2);
  const cutAmount = capToCeo
    ? Decimal.min(requestedCut, ceoCut).toDecimalPlaces(2)
    : requestedCut;

  if (cutAmount.lte(0)) {
    return {
      created: false,
      cutNative: new Decimal(0),
      cutStatus: "EARNED" as const,
    };
  }

  const cutStatus =
    event.upstreamPaidAt || event.upstreamState === "paid"
      ? "PAID"
      : "EARNED";

  await tx.commissionSplit.create({
    data: {
      eventId: event.id,
      recipientId: teacherId,
      teacherStudentId: relationshipId,
      teacherStudentSequence: relationshipSequence,
      role: "TEACHER",
      depth,
      cutPercent: cutPercent.toDecimalPlaces(2).toNumber(),
      cutAmount: cutAmount.toNumber(),
      status: cutStatus,
      paidAt: cutStatus === "PAID" ? event.upstreamPaidAt ?? new Date() : null,
      forfeitedToCeo: false,
      forfeitureReason: null,
      idempotencyKey: event.rewardfulCommissionId
        ? `${event.rewardfulCommissionId}:teacher:${teacherId}`
        : `evt:${event.id}:teacher:${teacherId}`,
    },
  });
  await tx.commissionEvent.update({
    where: { id: event.id },
    data: {
      ceoCut: ceoCut.sub(cutAmount).toDecimalPlaces(2).toNumber(),
    },
  });

  return {
    created: true,
    cutNative: cutAmount,
    cutStatus,
  };
}

async function createUnpaidHistoricalTeacherSplitsTx(
  tx: DbClient,
  {
    teacherId,
    studentId,
    relationshipId,
    relationshipSequence,
    depth,
    teacherCut,
  }: {
    teacherId: string;
    studentId: string;
    relationshipId: string;
    relationshipSequence: number;
    depth: number;
    teacherCut: Prisma.Decimal;
  }
) {
  if (new Decimal(teacherCut.toString()).lte(0)) {
    return 0;
  }

  const historicalEvents = await tx.commissionEvent.findMany({
    where: {
      affiliateId: studentId,
      splits: {
        some: { role: "AFFILIATE", status: "EARNED" },
        none: { role: "TEACHER", recipientId: teacherId },
      },
    },
    select: {
      id: true,
      rewardfulCommissionId: true,
      fullAmount: true,
      ceoCut: true,
      currency: true,
      upstreamState: true,
      upstreamPaidAt: true,
      upstreamVoidedAt: true,
    },
  });

  let created = 0;
  for (const event of historicalEvents) {
    try {
      const result = await createTeacherSplitForExistingEventTx(tx, {
        event,
        teacherId,
        relationshipId,
        relationshipSequence,
        depth,
        teacherCutPercent: teacherCut,
      });
      if (result.created) {
        created += 1;
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }

  return created;
}

async function syncDepthTwoRelationshipsTx(
  tx: DbClient,
  {
    teacherId,
    rootStudentId,
    actorId,
    origin,
    now,
  }: {
    teacherId: string;
    rootStudentId: string;
    actorId: string;
    origin: "SELF_PROPOSAL" | "ADMIN_PAIR";
    now: Date;
  }
) {
  const studentsOfStudent = await tx.teacherStudent.findMany({
    where: {
      teacherId: rootStudentId,
      status: "ACTIVE",
      depth: 1,
      NOT: { studentId: teacherId },
    },
    select: { studentId: true },
  });

  for (const child of studentsOfStudent) {
    const existing = await tx.teacherStudent.findUnique({
      where: {
        teacherId_studentId: {
          teacherId,
          studentId: child.studentId,
        },
      },
      select: {
        id: true,
        status: true,
        teacherCut: true,
        activationSequence: true,
      },
    });

    if (!existing) {
      await tx.teacherStudent.create({
        data: {
          teacherId,
          studentId: child.studentId,
          depth: 2,
          teacherCut: 0,
          status: "ACTIVE",
          createdVia: origin,
          activationSequence: 1,
          activatedAt: now,
          deactivatedAt: null,
          reviewedAt: now,
          reviewedById: actorId,
        },
      });
      continue;
    }

    if (existing.status === "ACTIVE") {
      continue;
    }

    await tx.teacherStudent.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        depth: 2,
        createdVia: origin,
        activationSequence:
          existing.status === "DEACTIVATED"
            ? { increment: 1 }
            : undefined,
        activatedAt: now,
        deactivatedAt: null,
        reviewedAt: now,
        reviewedById: actorId,
      },
    });
  }
}

async function activateTeacherStudentRelationshipTx(
  tx: DbClient,
  {
    teacherId,
    studentId,
    actorId,
    origin = "ADMIN_PAIR",
    teacherCut,
    historicalBackfill = "UNPAID_ONLY",
  }: ActivateRelationshipOptions
) {
  const now = new Date();
  const existing = await tx.teacherStudent.findUnique({
    where: {
      teacherId_studentId: {
        teacherId,
        studentId,
      },
    },
    select: {
      id: true,
      teacherId: true,
      studentId: true,
      depth: true,
      teacherCut: true,
      status: true,
      createdVia: true,
      activationSequence: true,
      activatedAt: true,
      deactivatedAt: true,
    },
  });

  if (existing?.status === "ACTIVE") {
    return {
      relationship: existing,
      created: false,
      reactivated: false,
      historicalBackfillCreated: 0,
    };
  }

  let relationship: TeacherStudentRecord;
  if (existing) {
    relationship = await tx.teacherStudent.update({
      where: { id: existing.id },
      data: {
        teacherCut:
          teacherCut !== undefined
            ? teacherCut
            : existing.teacherCut.toNumber(),
        status: "ACTIVE",
        createdVia: existing.createdVia ?? origin,
        activationSequence:
          existing.status === "DEACTIVATED"
            ? { increment: 1 }
            : undefined,
        activatedAt: now,
        deactivatedAt: null,
        reviewedAt: now,
        reviewedById: actorId,
        depth: 1,
      },
      select: {
        id: true,
        teacherId: true,
        studentId: true,
        depth: true,
        teacherCut: true,
        status: true,
        createdVia: true,
        activationSequence: true,
        activatedAt: true,
        deactivatedAt: true,
      },
    });
  } else {
    relationship = await tx.teacherStudent.create({
      data: {
        teacherId,
        studentId,
        depth: 1,
        teacherCut: teacherCut ?? 0,
        status: "ACTIVE",
        createdVia: origin,
        activationSequence: 1,
        activatedAt: now,
        reviewedAt: now,
        reviewedById: actorId,
      },
      select: {
        id: true,
        teacherId: true,
        studentId: true,
        depth: true,
        teacherCut: true,
        status: true,
        createdVia: true,
        activationSequence: true,
        activatedAt: true,
        deactivatedAt: true,
      },
    });
  }

  await syncDepthTwoRelationshipsTx(tx, {
    teacherId,
    rootStudentId: studentId,
    actorId,
    origin,
    now,
  });

  let historicalBackfillCreated = 0;
  if (historicalBackfill === "UNPAID_ONLY") {
    historicalBackfillCreated = await createUnpaidHistoricalTeacherSplitsTx(tx, {
      teacherId,
      studentId,
      relationshipId: relationship.id,
      relationshipSequence: relationship.activationSequence,
      depth: relationship.depth,
      teacherCut: relationship.teacherCut,
    });
  }

  return {
    relationship,
    created: !existing,
    reactivated: existing?.status === "DEACTIVATED",
    historicalBackfillCreated,
  };
}

async function collectRestoreGapEventsTx(
  tx: DbClient,
  archive: {
    id: string;
    teacherStudentId: string;
    activationSequence: number;
    teacherId: string;
    studentId: string;
    teacherCut: Prisma.Decimal;
    archivedAt: Date;
  }
) {
  const cadToUsd = await getCadToUsdDecimal();
  const events = await tx.commissionEvent.findMany({
    where: {
      affiliateId: archive.studentId,
      conversionDate: { gt: archive.archivedAt },
      splits: {
        none: {
          role: "TEACHER",
          recipientId: archive.teacherId,
        },
      },
    },
    orderBy: { conversionDate: "desc" },
    select: {
      id: true,
      rewardfulCommissionId: true,
      fullAmount: true,
      ceoCut: true,
      currency: true,
      conversionDate: true,
      campaignName: true,
      upstreamState: true,
      upstreamDueAt: true,
      upstreamPaidAt: true,
      upstreamVoidedAt: true,
    },
  });

  const teacherCutPercent = new Decimal(archive.teacherCut.toString());

  const previews = events.map((event) => {
    const state = getSplitStateLabel(event);
    const requestedNative = new Decimal(event.fullAmount.toString())
      .mul(teacherCutPercent)
      .div(100)
      .toDecimalPlaces(2);
    const ceoCut = new Decimal(event.ceoCut.toString());
    const canGrant = state !== "VOIDED" && ceoCut.gt(0);
    const grantAmountNative = canGrant
      ? Decimal.min(requestedNative, ceoCut).toDecimalPlaces(2)
      : new Decimal(0);
    const grantAmountCad = roundMoney(
      toCad(grantAmountNative, event.currency, cadToUsd).toNumber()
    );

    let disabledReason: string | null = null;
    if (state === "VOIDED") {
      disabledReason =
        "This commission was voided, so it cannot be granted during restore.";
    } else if (grantAmountNative.lte(0)) {
      disabledReason =
        "There is no remaining house share available to grant on this commission.";
    }

    return {
      raw: event,
      preview: {
        eventId: event.id,
        rewardfulCommissionId: event.rewardfulCommissionId,
        conversionDate: event.conversionDate.toISOString(),
        campaignName: event.campaignName,
        currency: event.currency.toUpperCase() as "CAD" | "USD",
        currentState: state,
        releasesAt: event.upstreamDueAt?.toISOString() ?? null,
        paidAt: event.upstreamPaidAt?.toISOString() ?? null,
        teacherCutPercent: teacherCutPercent.toNumber(),
        grantAmountNative: grantAmountNative.toNumber(),
        grantAmountCad,
        canGrant: canGrant && grantAmountNative.gt(0),
        disabledReason,
      } satisfies RestoreGapCommissionPreview,
    };
  });

  return previews;
}

async function completeRestoreTx(
  tx: DbClient,
  {
    archive,
    reviewedById,
    reviewNote,
    backfillMode,
    selectedEventIds,
    requestToUpdate,
  }: {
    archive: {
      id: string;
      teacherStudentId: string;
      activationSequence: number;
      teacherId: string;
      studentId: string;
      depth: number;
      teacherCut: Prisma.Decimal;
      archivedAt: Date;
    };
    reviewedById: string;
    reviewNote: string | null;
    backfillMode: TeacherStudentBackfillMode;
    selectedEventIds: string[];
    requestToUpdate?: {
      id: string;
    } | null;
  }
) {
  const previews = await collectRestoreGapEventsTx(tx, archive);
  const eligibleIds = new Set(
    previews.filter((item) => item.preview.canGrant).map((item) => item.raw.id)
  );

  const chosenIds =
    backfillMode === "ALL"
      ? Array.from(eligibleIds)
      : backfillMode === "NONE"
      ? []
      : selectedEventIds.filter((id) => eligibleIds.has(id));

  const activation = await activateTeacherStudentRelationshipTx(tx, {
    teacherId: archive.teacherId,
    studentId: archive.studentId,
    actorId: reviewedById,
    teacherCut: archive.teacherCut.toNumber(),
    historicalBackfill: "NONE",
  });

  const chosenIdSet = new Set(chosenIds);
  const cadToUsd = await getCadToUsdDecimal();
  let grantedCount = 0;
  let grantedAmountCad = new Decimal(0);

  for (const item of previews) {
    if (!chosenIdSet.has(item.raw.id) || !item.preview.canGrant) continue;
    try {
      const result = await createTeacherSplitForExistingEventTx(tx, {
        event: item.raw,
        teacherId: archive.teacherId,
        relationshipId: activation.relationship.id,
        relationshipSequence: activation.relationship.activationSequence,
        depth: archive.depth,
        teacherCutPercent: archive.teacherCut,
      });
      if (!result.created) continue;
      grantedCount += 1;
      grantedAmountCad = grantedAmountCad.add(
        toCad(result.cutNative, item.raw.currency, cadToUsd)
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }

  const pendingRequest = requestToUpdate
    ? await tx.teacherStudentRestoreRequest.update({
        where: { id: requestToUpdate.id },
        data: {
          status: "APPROVED",
          reviewedById,
          reviewedAt: new Date(),
          reviewNote,
          backfillMode,
          grantedEventIds: chosenIds,
          grantedCount,
          grantedAmountCad: grantedAmountCad.toDecimalPlaces(2).toNumber(),
        },
      })
    : await tx.teacherStudentRestoreRequest.findFirst({
        where: {
          archiveId: archive.id,
          status: "PENDING",
        },
      });

  if (!requestToUpdate && pendingRequest) {
    await tx.teacherStudentRestoreRequest.update({
      where: { id: pendingRequest.id },
      data: {
        status: "APPROVED",
        reviewedById,
        reviewedAt: new Date(),
        reviewNote:
          reviewNote ??
          "Approved directly from the managed affiliate workspace.",
        backfillMode,
        grantedEventIds: chosenIds,
        grantedCount,
        grantedAmountCad: grantedAmountCad.toDecimalPlaces(2).toNumber(),
      },
    });
  }

  return {
    relationship: activation.relationship,
    grantedCount,
    grantedAmountCad: roundMoney(grantedAmountCad.toNumber()),
    backfillMode,
    grantedEventIds: chosenIds,
  };
}

export async function getTeacherRelationshipEpisodeSummary(
  teacherId: string,
  relationshipId: string,
  relationshipSequence: number
) {
  const cadToUsd = await getCadToUsdDecimal();
  return getTeacherRelationshipEpisodeSummaryDb(prisma, {
    teacherId,
    relationshipId,
    relationshipSequence,
    cadToUsd,
  });
}

export async function archiveTeacherStudentRelationship(
  options: ArchiveRelationshipOptions
) {
  // Fetch external/cache-backed currency data before opening the transaction.
  // Holding a DB transaction open while waiting on exchange-rate refreshes can
  // make high-history removals time out and surface as a generic archive error.
  const cadToUsd = await getCadToUsdDecimal();

  return prisma.$transaction(async (tx) => {
    const relationship = await tx.teacherStudent.findUnique({
      where: { id: options.relationshipId },
      select: {
        id: true,
        teacherId: true,
        studentId: true,
        depth: true,
        teacherCut: true,
        status: true,
        createdVia: true,
        activationSequence: true,
        activatedAt: true,
        deactivatedAt: true,
      },
    });

    if (!relationship) {
      throw new Error("Relationship not found");
    }

    if (relationship.status !== "ACTIVE") {
      throw new Error("Relationship is not active");
    }

    const now = new Date();
    const showInPreviousStudents = options.showInPreviousStudents ?? true;
    const archives = [
      await createArchiveRecordTx(tx, relationship, {
        archivedById: options.archivedById,
        archivedByRole: options.archivedByRole,
        showInPreviousStudents,
        archiveReason: options.archiveReason ?? null,
        now,
        cadToUsd,
      }),
    ];

    let cascaded = 0;
    if (relationship.depth === 1) {
      const studentsOfStudent = await tx.teacherStudent.findMany({
        where: {
          teacherId: relationship.studentId,
          status: "ACTIVE",
          depth: 1,
        },
        select: { studentId: true },
      });
      const candidateIds = studentsOfStudent.map((student) => student.studentId);

      if (candidateIds.length > 0) {
        const otherBridges = await tx.teacherStudent.findMany({
          where: {
            teacherId: relationship.teacherId,
            status: "ACTIVE",
            depth: 1,
            NOT: { id: relationship.id },
          },
          select: { studentId: true },
        });
        const otherBridgeIds = otherBridges.map((bridge) => bridge.studentId);
        const survivingBridges = otherBridgeIds.length
          ? await tx.teacherStudent.findMany({
              where: {
                teacherId: { in: otherBridgeIds },
                studentId: { in: candidateIds },
                status: "ACTIVE",
                depth: 1,
              },
              select: { studentId: true },
            })
          : [];
        const survivingIds = new Set(
          survivingBridges.map((bridge) => bridge.studentId)
        );
        const depthTwoToArchive = await tx.teacherStudent.findMany({
          where: {
            teacherId: relationship.teacherId,
            studentId: {
              in: candidateIds.filter((candidateId) => !survivingIds.has(candidateId)),
            },
            status: "ACTIVE",
            depth: 2,
          },
          select: {
            id: true,
            teacherId: true,
            studentId: true,
            depth: true,
            teacherCut: true,
            status: true,
            createdVia: true,
            activationSequence: true,
            activatedAt: true,
            deactivatedAt: true,
          },
        });

        for (const derived of depthTwoToArchive) {
          await createArchiveRecordTx(tx, derived, {
            archivedById: options.archivedById,
            archivedByRole: options.archivedByRole,
            showInPreviousStudents,
            archiveReason:
              options.archiveReason ??
              "Indirect relationship ended because the direct teacher link was removed.",
            now,
            cadToUsd,
          });
        }

        if (depthTwoToArchive.length > 0) {
          await tx.teacherStudent.updateMany({
            where: { id: { in: depthTwoToArchive.map((item) => item.id) } },
            data: {
              status: "DEACTIVATED",
              deactivatedAt: now,
              reviewedAt: now,
              reviewedById: options.archivedById,
            },
          });
          cascaded = depthTwoToArchive.length;
        }
      }
    }

    await tx.teacherStudent.update({
      where: { id: relationship.id },
      data: {
        status: "DEACTIVATED",
        deactivatedAt: now,
        reviewedAt: now,
        reviewedById: options.archivedById,
      },
    });

    return {
      ok: true,
      relationshipId: relationship.id,
      archiveId: archives[0].id,
      cascaded,
    };
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function activateTeacherStudentRelationship(
  options: ActivateRelationshipOptions
) {
  return prisma.$transaction((tx) =>
    activateTeacherStudentRelationshipTx(tx, options)
  );
}

export async function getRestoreGapPreview(archiveId: string) {
  const archive = await prisma.teacherStudentArchive.findUnique({
    where: { id: archiveId },
    include: {
      teacherStudent: true,
      teacher: {
        select: { id: true, name: true, email: true },
      },
      student: {
        select: { id: true, name: true, email: true },
      },
      restoreRequests: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          createdAt: true,
          requestNote: true,
          requestedById: true,
        },
      },
    },
  });

  if (!archive) {
    throw new Error("Archived relationship not found");
  }

  const previews = await collectRestoreGapEventsTx(prisma, archive);
  const gapTotals = previews.reduce(
    (acc, item) => {
      acc.totalCount += 1;
      if (item.preview.canGrant) {
        acc.grantableCount += 1;
        acc.grantableCad += item.preview.grantAmountCad;
      }
      if (item.preview.currentState === "PAID") {
        acc.paidCad += item.preview.grantAmountCad;
      } else if (item.preview.currentState === "DUE_NOW") {
        acc.dueCad += item.preview.grantAmountCad;
      } else if (item.preview.currentState === "IN_HOLDING") {
        acc.pendingCad += item.preview.grantAmountCad;
      }
      return acc;
    },
    {
      totalCount: 0,
      grantableCount: 0,
      grantableCad: 0,
      paidCad: 0,
      dueCad: 0,
      pendingCad: 0,
    }
  );

  return {
    archiveId: archive.id,
    relationshipId: archive.teacherStudentId,
    teacherId: archive.teacherId,
    studentId: archive.studentId,
    studentName: archive.student.name,
    studentEmail: archive.student.email,
    teacherName: archive.teacher.name,
    teacherEmail: archive.teacher.email,
    teacherCutPercent: archive.teacherCut.toNumber(),
    archivedAt: archive.archivedAt.toISOString(),
    archivedByRole: archive.archivedByRole,
    archiveReason: archive.archiveReason,
    snapshot: {
      teacherUnpaidCad: archive.snapshotUnpaidCad.toNumber(),
      teacherDueCad: archive.snapshotDueCad.toNumber(),
      teacherPendingCad: archive.snapshotPendingCad.toNumber(),
      teacherPaidCad: archive.snapshotPaidCad.toNumber(),
      nextDueAt: archive.snapshotNextDueAt?.toISOString() ?? null,
      commissionCount: archive.snapshotCommissionCount,
    },
    gap: {
      totalCount: gapTotals.totalCount,
      grantableCount: gapTotals.grantableCount,
      grantableCad: roundMoney(gapTotals.grantableCad),
      paidCad: roundMoney(gapTotals.paidCad),
      dueCad: roundMoney(gapTotals.dueCad),
      pendingCad: roundMoney(gapTotals.pendingCad),
    },
    commissions: previews.map((item) => item.preview),
    pendingRequest: archive.restoreRequests[0]
      ? {
          id: archive.restoreRequests[0].id,
          createdAt: archive.restoreRequests[0].createdAt.toISOString(),
          requestNote: archive.restoreRequests[0].requestNote,
          requestedById: archive.restoreRequests[0].requestedById,
        }
      : null,
  } satisfies RestoreGapPreview;
}

export async function requestTeacherStudentRestore({
  archiveId,
  requestedById,
  requestNote,
}: {
  archiveId: string;
  requestedById: string;
  requestNote?: string | null;
}) {
  const archive = await prisma.teacherStudentArchive.findUnique({
    where: { id: archiveId },
    include: {
      teacherStudent: {
        select: { id: true, teacherId: true, studentId: true, status: true, depth: true },
      },
      restoreRequests: {
        where: { status: "PENDING" },
        select: { id: true },
      },
    },
  });

  if (!archive) {
    throw new Error("Archived relationship not found");
  }

  if (archive.teacherStudent.teacherId !== requestedById) {
    throw new Error("Only the archived teacher can request this restore");
  }

  if (archive.teacherStudent.depth !== 1) {
    throw new Error("Only direct student relationships can be restored by request");
  }

  if (archive.teacherStudent.status === "ACTIVE") {
    throw new Error("This student is already active under the teacher");
  }

  if (archive.restoreRequests.length > 0) {
    throw new Error("A restore request is already pending for this archived student");
  }

  return prisma.teacherStudentRestoreRequest.create({
    data: {
      teacherStudentId: archive.teacherStudentId,
      archiveId,
      requestedById,
      requestNote: requestNote ?? null,
      status: "PENDING",
    },
  });
}

export async function reviewTeacherStudentRestoreRequest(
  options: ReviewRestoreRequestOptions
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.teacherStudentRestoreRequest.findUnique({
      where: { id: options.requestId },
      include: {
        archive: true,
        teacherStudent: true,
      },
    });

    if (!request) {
      throw new Error("Restore request not found");
    }

    if (request.status !== "PENDING") {
      throw new Error("Restore request has already been reviewed");
    }

    if (options.action === "reject") {
      await tx.teacherStudentRestoreRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          reviewedById: options.reviewedById,
          reviewedAt: new Date(),
          reviewNote: options.reviewNote ?? null,
          backfillMode: "NONE",
          grantedEventIds: [],
          grantedCount: 0,
          grantedAmountCad: 0,
        },
      });

      return {
        ok: true,
        status: TeacherStudentRestoreStatus.REJECTED,
        grantedCount: 0,
        grantedAmountCad: 0,
      };
    }

    return completeRestoreTx(tx, {
      archive: request.archive,
      reviewedById: options.reviewedById,
      reviewNote: options.reviewNote ?? null,
      backfillMode: options.backfillMode ?? "NONE",
      selectedEventIds: options.selectedEventIds ?? [],
      requestToUpdate: { id: request.id },
    });
  });
}

export async function restoreTeacherStudentDirect(options: DirectRestoreOptions) {
  return prisma.$transaction(async (tx) => {
    const archive = await tx.teacherStudentArchive.findUnique({
      where: { id: options.archiveId },
    });

    if (!archive) {
      throw new Error("Archived relationship not found");
    }

    return completeRestoreTx(tx, {
      archive,
      reviewedById: options.reviewedById,
      reviewNote: options.reviewNote ?? null,
      backfillMode: options.backfillMode,
      selectedEventIds: options.selectedEventIds ?? [],
    });
  });
}
