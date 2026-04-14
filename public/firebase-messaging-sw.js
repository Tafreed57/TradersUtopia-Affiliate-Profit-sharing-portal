/* eslint-disable no-undef */
// Firebase Cloud Messaging Service Worker
// Handles background push notifications and offline fallback.

const CACHE_NAME = "tu-offline-v1";
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

// Serve offline page when navigation fails
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached || new Response("Offline", { status: 503 }))
    )
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
  const { title, body } = payload.notification || {};
  if (!title) return;

  self.registration.showNotification(title, {
    body: body || "",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    data: payload.data || {},
  });
});
