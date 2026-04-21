import * as Sentry from "@sentry/nextjs";
import admin from "firebase-admin";

let cachedMessaging: admin.messaging.Messaging | null | undefined;
let missingCredsLogged = false;
let initErrorLogged = false;

/**
 * Lazily initialize Firebase Admin messaging. Returning null keeps notification
 * creation alive even in environments where push credentials are absent.
 */
export function getMessaging(): admin.messaging.Messaging | null {
  if (cachedMessaging !== undefined) {
    return cachedMessaging;
  }

  if (admin.apps.length > 0) {
    cachedMessaging = admin.app().messaging();
    return cachedMessaging;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    if (!missingCredsLogged) {
      missingCredsLogged = true;
      const message =
        "[notifications] Firebase Admin SDK credentials are missing; push delivery disabled for this runtime.";
      console.warn(message);
      if (process.env.NODE_ENV === "production") {
        Sentry.captureMessage(message, "warning");
      }
    }
    cachedMessaging = null;
    return cachedMessaging;
  }

  try {
    const app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    cachedMessaging = app.messaging();
    return cachedMessaging;
  } catch (error) {
    if (!initErrorLogged) {
      initErrorLogged = true;
      console.error("[notifications] Firebase Admin initialization failed:", error);
      Sentry.captureException(error, {
        tags: { subsystem: "notifications", stage: "firebase-admin-init" },
      });
    }
    cachedMessaging = null;
    return cachedMessaging;
  }
}

const firebaseAdminHelpers = { getMessaging };

export default firebaseAdminHelpers;
