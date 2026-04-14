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
async function registerToken() {
  const token = await requestNotificationPermission();
  if (!token) return;

  try {
    await fetch("/api/notifications/register-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: "web" }),
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
