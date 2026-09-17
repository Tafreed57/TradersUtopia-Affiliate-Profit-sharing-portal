import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Traders Utopia Affiliate Work",
  description: "Your everyday workspace for attendance and promo codes.",
  manifest: "/work-manifest.json",
  appleWebApp: { capable: true, title: "Affiliate Work", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#11100e" };

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
