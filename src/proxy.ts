import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/constants";

const publicPaths = [
  "/login",
  "/register",
  "/api/auth",
  "/api/webhooks",
  // Vercel Cron hits these without a NextAuth session; the route handlers
  // enforce CRON_SECRET Bearer auth themselves, so the middleware must not
  // redirect them to /login before the handler runs.
  "/api/cron",
];

function isPublic(pathname: string) {
  return publicPaths.some((p) => pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only routes. Re-evaluate from token.email + current env
  // allowlist instead of trusting the stale token.isAdmin flag. This
  // means adding/removing an admin email via ADMIN_EMAIL env takes
  // effect on the next request without requiring the user to sign
  // out and back in.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const admin = isAdminEmail(
      typeof token.email === "string" ? token.email : null
    );
    if (!admin) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|firebase-messaging-sw.js).*)",
  ],
};
