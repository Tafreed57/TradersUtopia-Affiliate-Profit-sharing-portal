import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/constants";
import { canAccessWorkRoute, isWorkPortalUser } from "@/lib/account-access";
import { prisma } from "@/lib/prisma";

const publicPaths = [
  "/login",
  "/register",
  "/work",
  "/auth/complete",
  "/brand",
  "/api/auth",
  "/api/webhooks",
  // Vercel Cron hits these without a NextAuth session; the route handlers
  // enforce CRON_SECRET Bearer auth themselves, so the middleware must not
  // redirect them to /login before the handler runs.
  "/api/cron",
];

function isPublic(pathname: string) {
  return publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    ["/offline.html", "/work-manifest.json"].includes(pathname);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token || !(token.id || token.sub)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Read the current record, including for JWTs issued before account types existed.
  // Authorization fails closed if the account has gone away or cannot be checked.
  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: token.id || token.sub! },
      select: { accountType: true, status: true, email: true },
    });
  } catch {
    return NextResponse.json({ error: "Account access is temporarily unavailable" }, { status: 503 });
  }
  if (!user || user.status !== "ACTIVE") {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const admin = isAdminEmail(user.email);

  // Admin-only routes. Re-evaluate from token.email + current env
  // allowlist instead of trusting the stale token.isAdmin flag. This
  // means adding/removing an admin email via ADMIN_EMAIL env takes
  // effect on the next request without requiring the user to sign
  // out and back in.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (!admin) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (isWorkPortalUser({ ...user, isAdmin: admin }) && !canAccessWorkRoute(pathname, req.method)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.redirect(new URL("/attendance", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|firebase-messaging-sw.js).*)",
  ],
};
