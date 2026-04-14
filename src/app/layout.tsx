import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";

import { CurrencyProvider } from "@/providers/currency-provider";
import { QueryProvider } from "@/providers/query-provider";
import { SessionProvider } from "@/providers/session-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TradersUtopia Affiliate Portal",
  description: "Track your affiliate commissions and marketing activity",
  manifest: "/manifest.json",
  icons: [
    { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    { rel: "apple-touch-icon", url: "/icons/apple-touch-icon.png" },
  ],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TU Portal",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0f14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider>
          <QueryProvider>
            <CurrencyProvider>
              <TooltipProvider>
                {children}
              <Toaster
                theme="dark"
                position="bottom-right"
                richColors
                closeButton
              />
              </TooltipProvider>
            </CurrencyProvider>
          </QueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
