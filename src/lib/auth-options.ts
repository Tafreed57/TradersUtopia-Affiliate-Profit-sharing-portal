import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import type { AuthOptions } from "next-auth";
import type { AdapterUser } from "next-auth/adapters";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

import { linkRewardfulAffiliateWithTimeout } from "@/lib/auth-rewardful-link";
import { isAdminEmail } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { PortalAccountType } from "@/lib/account-access";

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma) as AuthOptions["adapter"],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      allowDangerousEmailAccountLinking: true,
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
    newUser: "/auth/complete",
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
      token.id ||= token.sub ?? "";
      // Re-evaluate on every JWT refresh so admin-allowlist changes
      // (env var update + redeploy) take effect on the next request
      // instead of requiring sign-out/in. token.email is populated by
      // NextAuth from the initial user object and persists across
      // refreshes.
      token.isAdmin = isAdminEmail(token.email as string | null | undefined);
      // Persisted permissions also cover legacy sessions; never trust client updates.
      if (token.id) {
        const current = await prisma.user.findUnique({
          where: { id: token.id },
          select: { accountType: true, status: true },
        });
        if (!current || current.status !== "ACTIVE") {
          token.id = "";
          token.sub = "";
          token.isAdmin = false;
        } else {
          token.accountType = current.accountType;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.isAdmin = token.isAdmin;
        session.user.accountType = token.accountType;
      }
      return session;
    },
  },
};

/** Only actual insertion classifies a new user; linking an existing email does not. */
export function authOptionsForSignup(accountType: PortalAccountType): AuthOptions {
  return {
    ...authOptions,
    adapter: {
      ...authOptions.adapter,
      async createUser(data: Omit<AdapterUser, "id">) {
        const user = await prisma.user.create({
          data: {
            name: data.name,
            email: data.email.toLowerCase(),
            emailVerified: data.emailVerified,
            image: data.image,
            accountType,
            ...(accountType === "WORK" ? { canBeTeacher: false, canProposeRates: false } : {}),
          },
        });
        return user;
      },
    },
  };
}
