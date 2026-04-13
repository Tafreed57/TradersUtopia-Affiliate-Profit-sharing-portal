import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { getCadToUsdRate } from "@/lib/currency";

/**
 * GET /api/currency
 *
 * Returns the current CAD→USD exchange rate.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getCadToUsdRate();
  if (!result) {
    return NextResponse.json(
      { error: "Exchange rate unavailable" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    from: "CAD",
    to: "USD",
    rate: result.rate.toNumber(),
    stale: result.stale,
  });
}
