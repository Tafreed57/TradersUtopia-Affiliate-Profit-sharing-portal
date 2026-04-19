import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

import { linkRewardfulAffiliateWithTimeout } from "@/lib/auth-rewardful-link";
import { isAdminEmail } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// On Vercel, VERCEL_URL is auto-set to the deployment-specific URL which
// causes redirect_uri_mismatch with Google OAuth. Force NEXTAUTH_URL to
// take precedence. If neither is set, fall back to localhost for dev.
const NEXTAUTH_URL =
  process.env.NEXTAUTH_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma) as AuthOptions["adapter"],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });

        if (!user || !user.passwordHash) return null;
        if (user.status === "DEACTIVATED") return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    newUser: "/register",
  },
  events: {
    async createUser({ user }) {
      if (!user.email || !user.id) return;
      await linkRewardfulAffiliateWithTimeout({
        userId: user.id,
        email: user.email,
        name: user.name,
      });
    },
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const dbUser = await prisma.user.findUnique({
        where: { email: user.email.toLowerCase() },
      });
      if (dbUser?.status === "DEACTIVATED") return false;
      if (dbUser && !dbUser.rewardfulAffiliateId) {
        await linkRewardfulAffiliateWithTimeout({
          userId: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
        });
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      // Re-evaluate on every JWT refresh so admin-allowlist changes
      // (env var update + redeploy) take effect on the next request
      // instead of requiring sign-out/in. token.email is populated by
      // NextAuth from the initial user object and persists across
      // refreshes.
      token.isAdmin = isAdminEmail(token.email as string | null | undefined);
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.isAdmin = token.isAdmin;
      }
      return session;
    },
  },
};
