import { NextResponse } from "next/server";

/**
 * GET /api/sentry-test
 *
 * Deliberately throws so we can verify Sentry captures server errors.
 * Hit this URL once from a browser tab after deploy, confirm the event
 * lands in Sentry, then remove this file.
 */
export async function GET() {
  throw new Error(
    `Sentry smoke test @ ${new Date().toISOString()} — delete this route after verifying capture`
  );
  // eslint-disable-next-line @typescript-eslint/no-unreachable
  return NextResponse.json({ unreachable: true });
}
