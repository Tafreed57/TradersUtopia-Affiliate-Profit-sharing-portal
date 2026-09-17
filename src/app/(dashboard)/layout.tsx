import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { FcmProvider } from "@/components/notifications/fcm-provider";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { PortalShell } from "@/components/layout/portal-shell";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { isWorkPortalUser } from "@/lib/account-access";

export async function generateMetadata(): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  if (!isWorkPortalUser(session?.user)) return {};
  return {
    title: "Traders Utopia Affiliate Work",
    description: "Your workspace for live attendance and promotional codes.",
    manifest: "/work-manifest.json",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "TU Work" },
  };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  return (
    <PortalShell session={session}>
      <FcmProvider />
      <InstallPrompt />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </PortalShell>
  );
}
