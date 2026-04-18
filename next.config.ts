import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "tradersutopia",
  project: process.env.SENTRY_PROJECT ?? "tradersutopia-affiliate-portal",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    // Don't ship .map files to browsers — they're uploaded to Sentry for
    // symbolication and deleted from the static output afterwards.
    filesToDeleteAfterUpload: ["**/*.map"],
  },
  disableLogger: true,
  automaticVercelMonitors: true,
});
