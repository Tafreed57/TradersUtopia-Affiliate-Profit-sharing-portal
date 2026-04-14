import { getApp, getApps, initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/**
 * Get the Firebase Messaging instance. Only works in browser.
 */
export function getFirebaseMessaging() {
  if (typeof window === "undefined") return null;
  return getMessaging(app);
}

/**
 * Request notification permission and get the FCM device token.
 * Returns null if permission denied or messaging unavailable.
 */
export async function requestNotificationPermission(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!("Notification" in window)) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.error("VAPID key not configured");
    return null;
  }

  try {
    // Register service worker and wait until it's active
    await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const registration = await navigator.serviceWorker.ready;

    const messaging = getFirebaseMessaging();
    if (!messaging) return null;

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    return token || null;
  } catch (err) {
    console.error("Failed to get FCM token:", err);
    return null;
  }
}

/**
 * Listen for foreground messages. Returns an unsubscribe function.
 */
export function onForegroundMessage(
  callback: (payload: { title?: string; body?: string }) => void
) {
  const messaging = getFirebaseMessaging();
  if (!messaging) return () => {};

  return onMessage(messaging, (payload) => {
    callback({
      title: payload.notification?.title,
      body: payload.notification?.body,
    });
  });
}
