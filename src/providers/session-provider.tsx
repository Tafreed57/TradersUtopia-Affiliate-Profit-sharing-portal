"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

export function SessionProvider({ children, session }: { children: React.ReactNode; session?: Session | null }) {
  return (
    <NextAuthSessionProvider session={session} refetchInterval={30} refetchOnWindowFocus refetchWhenOffline={false}>
      {children}
    </NextAuthSessionProvider>
  );
}
