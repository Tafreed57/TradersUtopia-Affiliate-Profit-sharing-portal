// Firebase Cloud Messaging Service Worker
// Handles background push notifications and offline fallback.

const CACHE_NAME = "tu-offline-v2";
const OFFLINE_URL = "/offline.html";

// Pre-cache the offline page on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Serve offline page ONLY when the browser is actually offline.
// Previously any transient fetch rejection (CDN blip, opaque redirect,
// deployment cutover) served the cached offline page and users got stuck
// seeing "internet offline" even with working connectivity.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => {
      if (self.navigator && self.navigator.onLine === false) {
        return caches.match(OFFLINE_URL).then(
          (cached) => cached || new Response("Offline", { status: 503 })
        );
      }
      return new Response("Service unavailable", { status: 503 });
    })
  );
});

importScripts(
  "https://www.gstatic.com/firebasejs/11.8.1/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyC9l6ncEUNRkc8P8Vh4LS0IwTRmcNBSxe8",
  authDomain: "tradersutopia-affiliate-b857b.firebaseapp.com",
  projectId: "tradersutopia-affiliate-b857b",
  messagingSenderId: "838759329344",
  appId: "1:838759329344:web:bd59d4958b67aae08279a5",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // Notification payloads are already displayed automatically by FCM when
  // the web app is in the background. Calling showNotification() again for
  // the same payload creates duplicate phone alerts.
  if (payload.notification?.title) return;

  const title = payload.data?.title;
  const body = payload.data?.body;
  if (!title) return;

  self.registration.showNotification(title, {
    body: body || "",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    data: payload.data || {},
  });
});
