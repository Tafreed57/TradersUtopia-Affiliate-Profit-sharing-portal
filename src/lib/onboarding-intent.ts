import { createHmac, timingSafeEqual } from "node:crypto";
import type { PortalAccountType } from "./account-access.ts";

export const ONBOARDING_TTL_SECONDS = 15 * 60;
export interface OnboardingIntent {
  accountType: PortalAccountType;
  state: string;
  expiresAt: number;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`tu-onboarding-v1:${payload}`).digest("base64url");
}

export function encodeOnboardingIntent(
  accountType: PortalAccountType, state: string, secret: string, now = Date.now()
): string {
  if (!secret || !state) throw new Error("Authentication configuration is unavailable");
  const intent: OnboardingIntent = { accountType, state, expiresAt: now + ONBOARDING_TTL_SECONDS * 1000 };
  const payload = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function decodeOnboardingIntent(value: string | undefined, secret: string, now = Date.now()): OnboardingIntent | null {
  if (!value || !secret || value.length > 4096) return null;
  const pieces = value.split(".");
  if (pieces.length !== 2) return null;
  const [payload, supplied] = pieces;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const intent = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OnboardingIntent;
    if (!["COMMISSION", "WORK"].includes(intent.accountType) || typeof intent.state !== "string" || !intent.state) return null;
    if (!Number.isFinite(intent.expiresAt) || intent.expiresAt <= now || intent.expiresAt > now + ONBOARDING_TTL_SECONDS * 1000) return null;
    return intent;
  } catch { return null; }
}

export function onboardingCookieName(secure: boolean): string {
  return secure ? "__Host-tu-onboarding" : "tu-onboarding";
}

export function onboardingCookie(value: string, secure: boolean, clear = false): string {
  return `${onboardingCookieName(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : ONBOARDING_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}
