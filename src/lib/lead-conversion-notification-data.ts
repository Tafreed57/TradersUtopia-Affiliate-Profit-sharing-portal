export interface LeadConversionNotificationInput {
  referralId: string;
  affiliateUserId: string;
  teacherUserIds: string[];
}

export interface LeadConversionNotification {
  userId: string;
  dedupeKey: string;
  type: "CONVERSION_RECEIVED";
  title: string;
  body: string;
  data: { referralId: string };
}

export function buildLeadConversionNotifications({
  referralId,
  affiliateUserId,
  teacherUserIds,
}: LeadConversionNotificationInput): LeadConversionNotification[] {
  const recipientIds = [...new Set([affiliateUserId, ...teacherUserIds])];

  return recipientIds.map((userId) => ({
    userId,
    dedupeKey: `lead-conversion:${referralId}:${userId}`,
    type: "CONVERSION_RECEIVED",
    title: "New Conversion",
    body: "A new conversion was recorded.",
    data: { referralId },
  }));
}
