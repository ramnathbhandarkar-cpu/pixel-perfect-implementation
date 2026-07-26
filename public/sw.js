/* Swing Trade — minimal service worker (Phase 1)
 * Phase 6 replaces this with full offline + IndexedDB.
 */
const CACHE = "swing-trade-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never intercept API/auth calls
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/_")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("/"))),
  );
});

/* Phase 5 — Web Push */
self.addEventListener("push", (event) => {
  let payload = { title: "Swing Trade", body: "", severity: "info" };
  try {
    payload = Object.assign(payload, event.data ? event.data.json() : {});
  } catch (e) {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.severity === "critical" ? "critical" : undefined,
      renotify: payload.severity === "critical",
      requireInteraction: payload.severity === "critical",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return clients.openWindow("/alerts");
    }),
  );
});
