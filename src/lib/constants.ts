export const APP_NAME = "TradersUtopia Affiliate Portal";
export const APP_SHORT_NAME = "TU Portal";
export const APP_DESCRIPTION = "Track your affiliate commissions and marketing activity";

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

export const TEACHER_CUT_WARN_THRESHOLD = Number(
  process.env.TEACHER_CUT_WARN_THRESHOLD ?? "85"
);

export const PROMO_CODE_MIN_LENGTH = 4;
export const PROMO_CODE_MAX_LENGTH = 6;

export const CURRENCY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const MAX_TEACHER_DEPTH = 2;
