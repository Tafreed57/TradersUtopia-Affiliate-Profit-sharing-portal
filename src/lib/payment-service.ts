import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * Silent version of handleCommissionPaid — marks splits PAID without
 * notifications. Used for historical paid-status sync.
 */
export async function syncCommissionPaid(
  rewardfulCommissionId: string,
  paidAt: Date
): Promise<number> {
  const event = await prisma.commissionEvent.findUnique({
    where: { rewardfulCommissionId },
    select: { id: true },
  });
  if (!event) return 0;

  const res = await prisma.commissionSplit.updateMany({
    where: { eventId: event.id, status: "EARNED" },
    data: { status: "PAID", paidAt },
  });
  return res.count;
}

/**
 * Marks all EARNED splits for a given rewardfulCommissionId as PAID and
 * notifies each teacher once (10-minute dedup per teacher-student pair).
 *
 * Called by the webhook handler when Rewardful fires commission.updated
 * with state="paid".
 */
export async function handleCommissionPaid(
  rewardfulCommissionId: string,
  paidAt: Date
): Promise<{ updated: number }> {
  const event = await prisma.commissionEvent.findUnique({
    where: { rewardfulCommissionId },
    select: {
      id: true,
      affiliateId: true,
      splits: {
        where: { status: "EARNED" },
        select: { id: true, recipientId: true, role: true, cutCad: true },
      },
    },
  });
  if (!event || event.splits.length === 0) return { updated: 0 };

  await prisma.commissionSplit.updateMany({
    where: { id: { in: event.splits.map((s) => s.id) } },
    data: { status: "PAID", paidAt },
  });

  // Aggregate teacher cuts per teacher then notify once each.
  const byTeacher = new Map<string, { teacherId: string; cut: number }>();
  for (const s of event.splits) {
    if (s.role !== "TEACHER") continue;
    const prev = byTeacher.get(s.recipientId);
    byTeacher.set(s.recipientId, {
      teacherId: s.recipientId,
      cut: (prev?.cut ?? 0) + s.cutCad.toNumber(),
    });
  }

  for (const { teacherId, cut } of byTeacher.values()) {
    const recent = await prisma.notification.findFirst({
      where: {
        userId: teacherId,
        type: "STUDENT_PAYMENT_RECEIVED",
        createdAt: { gte: new Date(Date.now() - 600_000) },
        data: { path: ["studentId"], equals: event.affiliateId },
      },
    });
    if (recent) continue;

    const student = await prisma.user.findUnique({
      where: { id: event.affiliateId },
      select: { name: true, email: true },
    });
    const label = student?.name ?? student?.email ?? event.affiliateId;

    await createNotification({
      userId: teacherId,
      type: "STUDENT_PAYMENT_RECEIVED",
      title: "Student Payment Processed",
      body: `${label} received a payment — your cut of US$${cut.toFixed(2)} has been marked as paid.`,
      data: { studentId: event.affiliateId },
    });
  }

  return { updated: event.splits.length };
}

/**
 * Marks all splits for a given rewardfulCommissionId as VOIDED and notifies
 * the affiliate. Called when Rewardful fires commission.updated state="voided".
 */
export async function handleCommissionVoided(
  rewardfulCommissionId: string,
  voidedAt: Date
): Promise<{ updated: number }> {
  const event = await prisma.commissionEvent.findUnique({
    where: { rewardfulCommissionId },
    select: {
      id: true,
      affiliateId: true,
      currency: true,
      splits: {
        where: { status: { in: ["EARNED", "PAID", "PENDING"] } },
        select: { id: true, role: true, cutCad: true },
      },
    },
  });
  if (!event || event.splits.length === 0) return { updated: 0 };

  await prisma.commissionSplit.updateMany({
    where: { id: { in: event.splits.map((s) => s.id) } },
    data: { status: "VOIDED", voidedAt },
  });

  // Notify the affiliate (not teachers — keep it simple).
  const affiliateSplit = event.splits.find((s) => s.role === "AFFILIATE");
  if (affiliateSplit) {
    const sym = event.currency === "CAD" ? "CA$" : "US$";
    await createNotification({
      userId: event.affiliateId,
      type: "COMMISSION_VOIDED",
      title: "Commission Voided",
      body: `A commission of ${sym}${affiliateSplit.cutCad.toNumber().toFixed(2)} was voided due to a refund or chargeback.`,
      data: { rewardfulCommissionId },
    });
  }

  return { updated: event.splits.length };
}
