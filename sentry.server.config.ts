import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Sample 10% of normal requests; 100% in non-prod so local issues surface.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  // Only report in production — no need to spam Sentry during `next dev`.
  enabled: process.env.NODE_ENV === "production",
  debug: false,
});
