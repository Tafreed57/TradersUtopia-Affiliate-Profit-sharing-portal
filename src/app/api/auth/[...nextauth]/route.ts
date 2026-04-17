import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth-options";

// On Vercel, NextAuth may use VERCEL_URL (deployment-specific) instead of
// NEXTAUTH_URL, causing redirect_uri_mismatch. Force the stable production
// URL before NextAuth reads process.env.
if (process.env.VERCEL && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
}

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
