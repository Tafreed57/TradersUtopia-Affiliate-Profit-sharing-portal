"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import {
  onForegroundMessage,
  requestNotificationPermission,
} from "@/lib/firebase-client";

/**
 * FCM Provider — handles token registration and foreground message display.
 * Mount once in the dashboard layout.
 */
function getOrCreatePushDeviceId() {
  if (typeof window === "undefined") return null;

  const storageKey = "tu.push.device-id";

  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;

    const created =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    window.localStorage.setItem(storageKey, created);
    return created;
  } catch (error) {
    console.error("Failed to persist push device ID:", error);
    return null;
  }
}

async function registerToken() {
  const token = await requestNotificationPermission();
  if (!token) return;

  const deviceId = getOrCreatePushDeviceId();

  try {
    await fetch("/api/notifications/register-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        platform: "web",
        deviceId,
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
    });
  } catch (err) {
    console.error("Failed to register FCM token:", err);
  }
}

export function FcmProvider() {
  const { status } = useSession();
  const registered = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || registered.current) return;

    // Skip if notifications not supported
    if (typeof window === "undefined" || !("Notification" in window)) return;

    // If permission already granted, register immediately
    if (Notification.permission === "granted") {
      registered.current = true;
      registerToken();
      return;
    }

    // On iOS standalone (PWA), we can't auto-request — requires user gesture.
    // Leave registered.current false so a user-triggered action can call it later.
    const isIOSStandalone =
      "standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (isIOSStandalone && Notification.permission === "default") {
      // Don't auto-request on iOS PWA — permission must come from user gesture
      return;
    }

    // On other platforms with "default" permission, request on load
    registered.current = true;
    registerToken();
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    const refreshTokenOnFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (Notification.permission !== "granted") return;

      registered.current = true;
      void registerToken();
    };

    document.addEventListener("visibilitychange", refreshTokenOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", refreshTokenOnFocus);
    };
  }, [status]);

  // Show foreground notifications as toasts
  useEffect(() => {
    if (status !== "authenticated") return;

    const unsubscribe = onForegroundMessage(({ title, body }) => {
      if (title) {
        toast(title, { description: body });
      }
    });

    return unsubscribe;
  }, [status]);

  return null;
}
