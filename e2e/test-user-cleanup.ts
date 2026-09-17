import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const trackedEmails = new Set<string>();
const TEST_USER_NAMES = [
  "Dashboard Test User",
  "Test User",
  "Login Test User",
] as const;

export function trackTestUser(email: string) {
  if (!email.toLowerCase().endsWith("@example.com")) {
    throw new Error("E2E cleanup only accepts generated @example.com users");
  }
  trackedEmails.add(email.toLowerCase());
}

export async function cleanupTrackedTestUsers() {
  const emails = [...trackedEmails];
  trackedEmails.clear();
  if (emails.length === 0) return;

  await prisma.user.deleteMany({
    where: {
      email: { in: emails },
      name: { in: [...TEST_USER_NAMES] },
      rewardfulAffiliateId: null,
    },
  });
}
