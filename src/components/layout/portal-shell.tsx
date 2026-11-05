"use client";

import type { Session } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef } from "react";

export function PortalShell({ children, session }: { children: React.ReactNode; session: Session }) {
  const { data: currentSession, status } = useSession();
  const signingOut = useRef(false);
  const isWork = session?.user?.accountType === "WORK" && !session.user.isAdmin;
  const loginPath = isWork ? "/work" : "/login";
  const accessRevoked = !!currentSession?.user && !currentSession.user.id;

  useEffect(() => {
    if (status === "loading" || currentSession?.user?.id || signingOut.current) return;
    signingOut.current = true;
    // NextAuth also returns null after a failed session fetch. Redirect in that
    // case without destroying a potentially valid cookie during a network outage.
    if (!accessRevoked) {
      window.location.replace(loginPath);
      return;
    }
    const callbackUrl = `${loginPath}?error=AccountDeactivated`;
    // A live status check in the session callback revokes server access immediately.
    // Clear the browser session too, including dashboards left open without navigation.
    void signOut({ callbackUrl }).catch(() => window.location.replace(callbackUrl));
  }, [currentSession?.user?.id, status, loginPath, accessRevoked]);

  // Unmount protected data as soon as the refreshed session loses its identity.
  if (status !== "authenticated" || !currentSession?.user?.id) return null;
  return <div className={`${isWork ? "work-theme " : ""}flex h-screen overflow-hidden bg-background`}>{children}</div>;
}
