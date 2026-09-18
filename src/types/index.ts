import type { DefaultSession, DefaultUser } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isAdmin: boolean;
      accountType: "COMMISSION" | "WORK";
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    isAdmin?: boolean;
    accountType?: "COMMISSION" | "WORK";
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    isAdmin: boolean;
    accountType: "COMMISSION" | "WORK";
  }
}
