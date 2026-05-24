import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import {
  getCompanyPerformance,
  normalizeCompanyPerformanceRange,
} from "@/lib/company-performance-service";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = normalizeCompanyPerformanceRange(
    req.nextUrl.searchParams.get("range")
  );

  try {
    const performance = await getCompanyPerformance({
      range,
      includeFinancials: false,
    });
    return NextResponse.json(performance);
  } catch (error) {
    console.error("[company-performance-api] failed:", error);
    return NextResponse.json(
      { error: "Company performance is temporarily unavailable" },
      { status: 503 }
    );
  }
}

