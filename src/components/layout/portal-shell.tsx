"use client";

import type { Session } from "next-auth";

export function PortalShell({ children, session }: { children: React.ReactNode; session: Session }) {
  const isWork = session?.user?.accountType === "WORK" && !session.user.isAdmin;
  return <div className={`${isWork ? "work-theme " : ""}flex h-screen overflow-hidden bg-background`}>{children}</div>;
}
