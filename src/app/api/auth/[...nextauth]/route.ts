import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions, authOptionsForSignup } from "@/lib/auth-options";
import {
  decodeOnboardingIntent,
  encodeOnboardingIntent,
  onboardingCookie,
  onboardingCookieName,
} from "@/lib/onboarding-intent";
import type { PortalAccountType } from "@/lib/account-access";

// On Vercel, NextAuth may use VERCEL_URL (deployment-specific) instead of
// NEXTAUTH_URL, causing redirect_uri_mismatch. Force the stable production
// URL before NextAuth reads process.env.
if (process.env.VERCEL && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
}

type Context = { params: Promise<{ nextauth: string[] }> };

async function handler(req: NextRequest, context: Context): Promise<Response> {
  const { nextauth } = await context.params;
  const isGoogleStart = req.method === "POST" && nextauth.join("/") === "signin/google";
  const isGoogleCallback = nextauth.join("/") === "callback/google";
  const secure = new URL(process.env.NEXTAUTH_URL ?? req.url).protocol === "https:";
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "";
  let accountType: PortalAccountType = "COMMISSION";

  if (isGoogleStart) {
    const body = await req.clone().formData();
    const requested = body.get("onboardingType") ?? "COMMISSION";
    if (requested !== "WORK" && requested !== "COMMISSION") {
      return NextResponse.json({ error: "Invalid signup option" }, { status: 400 });
    }
    accountType = requested;
  }

  if (isGoogleCallback) {
    const intent = decodeOnboardingIntent(req.cookies.get(onboardingCookieName(secure))?.value, secret);
    if (!intent || intent.state !== req.nextUrl.searchParams.get("state")) {
      const restart = new URL(intent?.accountType === "WORK" ? "/work" : "/login", req.url);
      restart.searchParams.set("error", "OnboardingExpired");
      const response = NextResponse.redirect(restart);
      // A late callback must not destroy the newer attempt's valid cookie.
      if (!intent) response.headers.append("Set-Cookie", onboardingCookie("", secure, true));
      return response;
    }
    accountType = intent.accountType;
  }

  const options = isGoogleCallback ? authOptionsForSignup(accountType) : authOptions;
  const response = await NextAuth(options)(req, context) as Response;

  if (isGoogleStart) {
    let authorizationUrl = response.headers.get("Location");
    if (!authorizationUrl && response.headers.get("Content-Type")?.includes("application/json")) {
      const body = await response.clone().json() as { url?: string };
      authorizationUrl = body.url ?? null;
    }
    if (authorizationUrl) {
      const state = new URL(authorizationUrl, req.url).searchParams.get("state");
      if (state) {
        response.headers.append("Set-Cookie", onboardingCookie(encodeOnboardingIntent(accountType, state, secret), secure));
      } else {
        response.headers.append("Set-Cookie", onboardingCookie("", secure, true));
      }
    }
  } else if (isGoogleCallback) {
    response.headers.append("Set-Cookie", onboardingCookie("", secure, true));
    const location = response.headers.get("Location");
    if (accountType === "WORK" && location) {
      const destination = new URL(location, req.url);
      if (destination.pathname === "/api/auth/error" || destination.pathname === "/login") {
        response.headers.set("Location", new URL(`/work?error=${encodeURIComponent(destination.searchParams.get("error") ?? "OAuthSignin")}`, req.url).toString());
      }
    }
  }
  return response;
}

export { handler as GET, handler as POST };
