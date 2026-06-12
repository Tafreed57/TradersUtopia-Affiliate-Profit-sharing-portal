import type { CommissionStatus } from "@prisma/client";

export const UNPAID_HISTORICAL_AFFILIATE_STATUSES: CommissionStatus[] = [
  "EARNED",
  "PENDING",
];

export function shouldBackfillHistoricalTeacherSplitForAffiliateStatus(
  status: CommissionStatus
) {
  return UNPAID_HISTORICAL_AFFILIATE_STATUSES.includes(status);
}
