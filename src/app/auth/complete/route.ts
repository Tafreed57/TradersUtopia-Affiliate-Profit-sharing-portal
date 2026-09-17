import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { safePortalDestination } from "@/lib/account-access";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));
  const next = req.nextUrl.searchParams.get("next");
  return NextResponse.redirect(new URL(safePortalDestination(next, session.user), req.url));
}
