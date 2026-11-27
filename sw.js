/* Healthy Plate service worker: push notifications + a small offline cache of the app shell.
 *
 * iOS rule: every push MUST show a visible notification. If a push arrives and nothing is shown,
 * Safari can switch the subscription off. So the push handler below always calls showNotification,
 * even when the message cannot be read.
 */
const VERSION = "hp-v4";
const SHELL = ["/", "/index.html", "/shared/tests.js", "/shared/calc.js", "/js/dash.js", "/js/notify.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for the app shell (so updates show up), cache as the fallback when offline. Never cache /api.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const isShell = req.mode === "navigate" || SHELL.includes(url.pathname);
  if (!isShell) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req.mode === "navigate" ? "/" : req).then((r) => r || caches.match("/index.html")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Healthy Plate";
  const opts = {
    body: d.body || "You have a new notification.",
    icon: d.icon || "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    timestamp: d.t || Date.now(),
    data: { url: d.url || "/" },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Tapping a notification opens the right page. It never changes or switches off a reminder.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          c.postMessage({ type: "hp-nav", url: target });
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

// The push service can replace a subscription. Tell open pages so they can register the new one.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      list.forEach((c) => c.postMessage({ type: "hp-resubscribe" }));
    })
  );
});
