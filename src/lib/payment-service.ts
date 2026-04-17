import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * Silent version of handleCommissionPaid — marks Commission rows PAID
 * without sending notifications. Used for historical paid-status sync.
 */
export async function syncCommissionPaid(
  rewardfulCommissionId: string,
  paidAt: Date
): Promise<number> {
  const rows = await prisma.commission.findMany({
    where: { rewardfulCommissionId, status: "EARNED" },
    select: { id: true },
  });
  if (!rows.length) return 0;
  await prisma.commission.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: "PAID", paidAt },
  });
  return rows.length;
}

/**
 * Marks all EARNED Commission rows for a given rewardfulCommissionId as PAID
 * and notifies each teacher once (10-minute dedup per teacher-student pair).
 *
 * Called by the webhook handler when Rewardful fires commission.updated
 * with state="paid".
 */
export async function handleCommissionPaid(
  rewardfulCommissionId: string,
  paidAt: Date
): Promise<{ updated: number }> {
  const rows = await prisma.commission.findMany({
    where: { rewardfulCommissionId, status: "EARNED" },
    select: { id: true, affiliateId: true, teacherId: true, teacherCutCad: true },
  });
  if (!rows.length) return { updated: 0 };

  await prisma.commission.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: "PAID", paidAt },
  });

  // Aggregate teacher cuts per (teacher, student) pair then notify once each.
  const byPair = new Map<string, { teacherId: string; affiliateId: string; cut: number }>();
  for (const r of rows) {
    if (!r.teacherId) continue;
    const k = `${r.teacherId}:${r.affiliateId}`;
    const prev = byPair.get(k);
    byPair.set(k, {
      teacherId: r.teacherId,
      affiliateId: r.affiliateId,
      cut: (prev?.cut ?? 0) + (r.teacherCutCad?.toNumber() ?? 0),
    });
  }

  for (const { teacherId, affiliateId, cut } of byPair.values()) {
    // 10-minute dedup: skip if already notified for this teacher-student pair
    const recent = await prisma.notification.findFirst({
      where: {
        userId: teacherId,
        type: "STUDENT_PAYMENT_RECEIVED",
        createdAt: { gte: new Date(Date.now() - 600_000) },
        data: { path: ["studentId"], equals: affiliateId },
      },
    });
    if (recent) continue;

    const student = await prisma.user.findUnique({
      where: { id: affiliateId },
      select: { name: true, email: true },
    });
    const label = student?.name ?? student?.email ?? affiliateId;

    await createNotification({
      userId: teacherId,
      type: "STUDENT_PAYMENT_RECEIVED",
      title: "Student Payment Processed",
      body: `${label} received a payment — your cut of US$${cut.toFixed(2)} has been marked as paid.`,
      data: { studentId: affiliateId },
    });
  }

  return { updated: rows.length };
}
