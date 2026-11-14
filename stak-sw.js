/* Stak notifications worker — push only, no caching. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Stak", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Stak", {
    body: d.body || "Your build is ready", tag: d.tag || "stak", icon: "./favicon.svg", badge: "./favicon.svg",
    data: { url: d.url || "./#/app" }, renotify: true,
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate ? c.navigate(target).catch(() => {}) : null; return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
