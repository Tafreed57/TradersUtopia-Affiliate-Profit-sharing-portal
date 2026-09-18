import { buildLeadConversionNotifications } from "@/lib/lead-conversion-notification-data";
import { createNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { isCommissionEligible } from "@/lib/account-access";

export { buildLeadConversionNotifications } from "@/lib/lead-conversion-notification-data";

export async function notifyReferralLead({
  referralId,
  affiliateRewardfulId,
}: {
  referralId: string;
  affiliateRewardfulId: string;
}) {
  const affiliate = await prisma.user.findUnique({
    where: { rewardfulAffiliateId: affiliateRewardfulId },
    select: { id: true, status: true, accountType: true },
  });

  if (!affiliate || affiliate.status !== "ACTIVE" || !isCommissionEligible(affiliate)) {
    return { status: "ignored", reason: "Affiliate unavailable" } as const;
  }

  const teacherRelations = await prisma.teacherStudent.findMany({
    where: {
      studentId: affiliate.id,
      status: "ACTIVE",
      depth: { in: [1, 2] },
      teacher: { status: "ACTIVE", accountType: "COMMISSION" },
    },
    select: { teacherId: true },
    orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
  });

  const notifications = buildLeadConversionNotifications({
    referralId,
    affiliateUserId: affiliate.id,
    teacherUserIds: teacherRelations.map((relation) => relation.teacherId),
  });
  const deliveries = await createNotifications(notifications);
  const failed = deliveries.filter(
    (delivery) => delivery.status === "rejected"
  ).length;

  return {
    status: "notified",
    recipients: notifications.length,
    failed,
  } as const;
}
