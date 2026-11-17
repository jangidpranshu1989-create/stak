// Stak service worker: Web Push notifications + offline app shell. API calls are never cached.
const SHELL = "stak-shell-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "./index.html"]).catch(() => {}))); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/api/")) return;
  if (r.mode === "navigate") { e.respondWith(fetch(r).then((res) => { caches.open(SHELL).then((c) => c.put("./index.html", res.clone())); return res; }).catch(() => caches.match("./index.html"))); return; }
  if (/\/assets\//.test(u.pathname)) e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => { const cp = res.clone(); caches.open(SHELL).then((c) => c.put(r, cp)); return res; })));
});
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Stak", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Stak", { body: d.body || "", tag: d.tag || "stak", icon: "./icon-192.png", badge: "./icon-192.png", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
