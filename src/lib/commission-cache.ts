import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function clearLifetimeStatsCacheForUsers(
  userIds: string[]
): Promise<void> {
  const distinctUserIds = [...new Set(userIds.filter(Boolean))];
  if (distinctUserIds.length === 0) return;

  await prisma.user.updateMany({
    where: { id: { in: distinctUserIds } },
    data: {
      lifetimeStatsCachedAt: null,
      lifetimeStatsJson: Prisma.JsonNull,
    },
  });
}
