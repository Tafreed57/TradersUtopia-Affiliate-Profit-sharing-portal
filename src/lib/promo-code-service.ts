import { randomUUID } from "node:crypto";
import type { Prisma, PromoCodeRequest } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { formatPromoCodeCreationError } from "@/lib/promo-code-campaign";
import { provisionPromoCode } from "@/lib/promo-code-provisioning";
import { chooseReservedRequest, PromoCodeConflict } from "@/lib/promo-code-reservation-policy";
import * as rewardful from "@/lib/rewardful";

const ACTIVE_STATUSES = ["PENDING_TEACHER", "APPROVED_TEACHER", "CREATING", "CREATED", "FAILED"] as const;
const LEASE_MS = 5 * 60_000;

export { PromoCodeConflict } from "@/lib/promo-code-reservation-policy";

async function lockCode(tx: Prisma.TransactionClient, code: string) {
  // UPDATE obtains a row lock until this short transaction completes. The code
  // primary key also serializes concurrent first reservations on every server.
  // Explicit native upsert avoids Prisma's read-then-insert upsert fallback
  // (nested relation reads can disable its native-upsert optimization).
  await tx.$executeRaw`
    INSERT INTO "PromoCodeReservation" ("code", "updatedAt") VALUES (${code}, CURRENT_TIMESTAMP)
    ON CONFLICT ("code") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
  `;
  return tx.promoCodeReservation.findUniqueOrThrow({ where: { code }, include: { request: true } });
}

export async function reservePromoCode(args: {
  requesterId: string;
  code: string;
  immediate: boolean;
  reviewerId?: string;
}): Promise<{ request: PromoCodeRequest; isNew: boolean }> {
  return prisma.$transaction(async (tx) => {
    const reservation = await lockCode(tx, args.code);
    if (reservation.leaseToken?.startsWith("delete:")) {
      throw new PromoCodeConflict("This code is being removed. Try a different code.");
    }
    const active = await tx.promoCodeRequest.findMany({
      where: {
        proposedCode: { equals: args.code, mode: "insensitive" },
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
    // Legacy duplicate rows are deliberately preserved by the migration. Never
    // guess which owner should receive their code or silently delete history.
    const owned = chooseReservedRequest(reservation.request, active, args.requesterId);
    if (owned) {
      await tx.promoCodeReservation.update({
        where: { code: args.code }, data: { requestId: owned.id },
      });
      return { request: owned, isNew: false };
    }
    const request = await tx.promoCodeRequest.create({
      data: {
        requesterId: args.requesterId,
        proposedCode: args.code,
        status: args.immediate ? "CREATING" : "PENDING_TEACHER",
        reviewerId: args.reviewerId ?? null,
      },
    });
    await tx.promoCodeReservation.update({
      where: { code: args.code },
      data: { requestId: request.id, leaseToken: null, leaseExpiresAt: null },
    });
    return { request, isNew: true };
  });
}

export async function createReservedPromoCode(args: {
  request: PromoCodeRequest;
  affiliateId: string;
  reviewerId?: string;
}) {
  const { request, affiliateId } = args;
  const code = request.proposedCode.toUpperCase();
  let creationToken: string | null = null;
  const result = await provisionPromoCode(code, affiliateId, {
    claim: async () => prisma.$transaction(async (tx) => {
      const reservation = await lockCode(tx, code);
      const current = await tx.promoCodeRequest.findUnique({ where: { id: request.id } });
      if (!current || current.status === "REJECTED_TEACHER") return { kind: "unavailable" as const };
      if (reservation.requestId && reservation.requestId !== request.id) return { kind: "unavailable" as const };
      // An interrupted deletion retains this fence until an admin retries it.
      // Expiration permits deletion recovery, never another provider creation.
      if (reservation.leaseToken?.startsWith("delete:")) return { kind: "unavailable" as const };
      const other = await tx.promoCodeRequest.count({
        where: { proposedCode: { equals: code, mode: "insensitive" }, id: { not: request.id }, status: { in: [...ACTIVE_STATUSES] } },
      });
      if (other > 0) return { kind: "unavailable" as const };
      if (current.status === "CREATED") return { kind: "created" as const };
      if (reservation.leaseExpiresAt && reservation.leaseExpiresAt > new Date()) return { kind: "busy" as const };
      const token = randomUUID();
      await tx.promoCodeReservation.update({
        where: { code },
        data: { requestId: request.id, leaseToken: token, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
      });
      await tx.promoCodeRequest.update({
        where: { id: request.id },
        data: { status: "CREATING", errorMessage: null, ...(args.reviewerId ? { reviewerId: args.reviewerId, reviewedAt: new Date() } : {}) },
      });
      creationToken = token;
      return { kind: "claimed" as const, token };
    }),
    list: () => rewardful.listAllCouponsForAffiliate(affiliateId),
    create: async () => {
      // A slow list request may outlive its lease while an admin removes the
      // coupon. Recheck the fence before starting a new external write.
      const lease = await prisma.promoCodeReservation.findUnique({ where: { code } });
      if (!lease || lease.requestId !== request.id || lease.leaseToken !== creationToken || !lease.leaseExpiresAt || lease.leaseExpiresAt <= new Date()) {
        throw new PromoCodeConflict("This code is being updated. Try again shortly.");
      }
      return rewardful.createCoupon({ affiliate_id: affiliateId, code });
    },
    complete: async (token, coupon) => prisma.$transaction(async (tx) => {
      const claim = await tx.promoCodeReservation.updateMany({
        where: { code, requestId: request.id, leaseToken: token },
        data: { leaseToken: null, leaseExpiresAt: null },
      });
      if (claim.count === 0) return false;
      await tx.promoCodeRequest.update({
        where: { id: request.id },
        data: {
          status: "CREATED", rewardfulCouponId: coupon.id,
          campaignId: coupon.campaign?.id ?? null,
          campaignName: coupon.campaign?.name ?? null, errorMessage: null,
        },
      });
      return true;
    }),
    fail: async (token, error) => {
      console.error(`[promo-code-create] failed for ${request.id}:`, error);
      await prisma.$transaction(async (tx) => {
        const claim = await tx.promoCodeReservation.updateMany({
          where: { code, requestId: request.id, leaseToken: token },
          data: { leaseToken: null, leaseExpiresAt: null },
        });
        if (claim.count === 0) return;
        await tx.promoCodeRequest.update({
          where: { id: request.id },
          data: { status: "FAILED", errorMessage: formatPromoCodeCreationError(error) },
        });
      });
    },
  });
  return { result, request: await prisma.promoCodeRequest.findUniqueOrThrow({ where: { id: request.id } }) };
}

export async function rejectReservedPromoCode(args: { requestId: string; reviewerId: string; reason: string | null }) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.promoCodeRequest.findUniqueOrThrow({ where: { id: args.requestId } });
    const reservation = await lockCode(tx, initial.proposedCode.toUpperCase());
    const current = await tx.promoCodeRequest.findUniqueOrThrow({ where: { id: args.requestId } });
    if (reservation.leaseToken?.startsWith("delete:")) {
      throw new PromoCodeConflict("Code removal must be completed before reviewing this request.");
    }
    if (reservation.leaseExpiresAt && reservation.leaseExpiresAt > new Date()) {
      throw new PromoCodeConflict("This code is being created. Try again shortly.");
    }
    if (current.status !== "PENDING_TEACHER" && current.status !== "FAILED") {
      throw new PromoCodeConflict("Request has already been reviewed");
    }
    // FAILED may represent an uncertain provider write. Keep its reservation
    // until an admin reconciles or deletes the provider coupon.
    if (current.status === "FAILED") throw new PromoCodeConflict("Retry code creation before rejecting this request.");
    const updated = await tx.promoCodeRequest.update({
      where: { id: args.requestId },
      data: { status: "REJECTED_TEACHER", reviewerId: args.reviewerId, rejectionReason: args.reason, reviewedAt: new Date() },
    });
    await tx.promoCodeReservation.updateMany({
      where: { code: current.proposedCode.toUpperCase(), requestId: args.requestId },
      data: { requestId: null, leaseToken: null, leaseExpiresAt: null },
    });
    return updated;
  });
}

export function workPromoCodeDto(request: PromoCodeRequest) {
  return {
    id: request.id, proposedCode: request.proposedCode, status: request.status,
    createdAt: request.createdAt, reviewedAt: request.reviewedAt,
    rejectionReason: request.status === "REJECTED_TEACHER" ? "This code is no longer active." : null,
    errorMessage: request.status === "FAILED" ? "This code could not be created. Try again." : null,
  };
}

/** Delete using the same lease as creation, repairing uncertain provider IDs first. */
export async function deleteOwnedPromoCode(args: {
  requesterId: string;
  reviewerId: string;
  couponId: string;
  code: string;
  reconcileUnlinkedRequest: boolean;
  providerAlreadyAbsent?: boolean;
}) {
  const code = args.code.toUpperCase();
  const token = `delete:${randomUUID()}`;
  const requestId = await prisma.$transaction(async (tx) => {
    const reservation = await lockCode(tx, code);
    if (reservation.leaseExpiresAt && reservation.leaseExpiresAt > new Date()) {
      throw new PromoCodeConflict("This code is being updated. Try again shortly.");
    }
    const reserved = reservation.request;
    if (reserved && reserved.status !== "REJECTED_TEACHER" && (
      reserved.requesterId !== args.requesterId ||
      (reserved.rewardfulCouponId && reserved.rewardfulCouponId !== args.couponId)
    )) {
      throw new PromoCodeConflict("This code has a conflicting request. Resolve that request first.");
    }
    const matches = await tx.promoCodeRequest.findMany({
      where: {
        requesterId: args.requesterId,
        OR: [
          { rewardfulCouponId: args.couponId },
          ...(args.reconcileUnlinkedRequest ? [{
            proposedCode: { equals: code, mode: "insensitive" as const },
            rewardfulCouponId: null,
            status: { in: [...ACTIVE_STATUSES] },
          }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (reserved && reserved.status !== "REJECTED_TEACHER" && !matches.some((match) => match.id === reserved.id)) {
      throw new PromoCodeConflict("This code has a conflicting request. Resolve that request first.");
    }
    // Record the observed provider ownership BEFORE deletion. If deletion
    // succeeds but local completion fails, retry can recover by coupon ID even
    // though the upstream list no longer contains the coupon.
    await tx.promoCodeRequest.updateMany({
      where: { id: { in: matches.map((match) => match.id) }, requesterId: args.requesterId, rewardfulCouponId: null },
      data: { rewardfulCouponId: args.couponId },
    });
    const primary = matches.find((match) => match.id === reservation.requestId) ?? matches[0] ??
      await tx.promoCodeRequest.create({
        data: {
          requesterId: args.requesterId, reviewerId: args.reviewerId,
          proposedCode: code, status: "CREATED", rewardfulCouponId: args.couponId,
          reviewedAt: new Date(),
        },
      });
    await tx.promoCodeReservation.update({
      where: { code },
      data: { requestId: primary.id, leaseToken: token, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    });
    return primary.id;
  });

  try {
    if (!args.providerAlreadyAbsent) {
      try {
        await rewardful.deleteCoupon(args.couponId);
      } catch (error) {
        // Confirmed absence is a successful retry after an uncertain deletion.
        if (!(error instanceof rewardful.RewardfulApiError && error.status === 404)) throw error;
      }
    }
    const completed = await prisma.$transaction(async (tx) => {
      const claim = await tx.promoCodeReservation.updateMany({
        where: { code, requestId, leaseToken: token },
        data: { requestId: null, leaseToken: null, leaseExpiresAt: null },
      });
      if (claim.count !== 1) return false;
      await tx.promoCodeRequest.updateMany({
        where: { requesterId: args.requesterId, rewardfulCouponId: args.couponId, status: { not: "REJECTED_TEACHER" } },
        data: {
          status: "REJECTED_TEACHER", rejectionReason: "Removed by admin",
          errorMessage: null, reviewedAt: new Date(), reviewerId: args.reviewerId,
        },
      });
      return true;
    });
    if (!completed) throw new PromoCodeConflict("Code removal is already being completed. Try again shortly.");
  } catch (error) {
    // Retain the deletion fence and coupon ownership. Only a retry of this
    // deletion can clear it; ordinary creation must never recreate the code.
    await prisma.promoCodeReservation.updateMany({
      where: { code, requestId, leaseToken: token }, data: { leaseExpiresAt: null },
    });
    throw error;
  }
}
