import type { CommissionStatus, UserStatus } from "@prisma/client";

export type CommissionStatusDecision = {
  affiliateStatus: CommissionStatus;
  affiliateForfeitedToCeo: boolean;
  affiliateReason: string | null;
  teacherStatus: CommissionStatus;
  teacherReason: string | null;
};

export function resolveCommissionStatus(input: {
  affiliateUserStatus: UserStatus;
  ratesConfigured: boolean;
}): CommissionStatusDecision {
  if (input.affiliateUserStatus !== "ACTIVE") {
    return {
      affiliateStatus: "FORFEITED",
      affiliateForfeitedToCeo: true,
      affiliateReason: "affiliate_deactivated",
      teacherStatus: "EARNED",
      teacherReason: null,
    };
  }

  if (!input.ratesConfigured) {
    return {
      affiliateStatus: "PENDING",
      affiliateForfeitedToCeo: false,
      affiliateReason: "rate_not_set",
      teacherStatus: "EARNED",
      teacherReason: null,
    };
  }

  return {
    affiliateStatus: "EARNED",
    affiliateForfeitedToCeo: false,
    affiliateReason: null,
    teacherStatus: "EARNED",
    teacherReason: null,
  };
}
