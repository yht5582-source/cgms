const SHELL_CACHE = "cgms-shell-v2.0";
const SHELL = ["./", "index.html", "styles.css?v=2.0", "core.js?v=2.0", "app.js?v=2.0", "manifest.webmanifest", "icon.svg", "icon-180.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("cgms-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(handleShare(event.request));
    return;
  }

  if (event.request.method === "GET" && url.pathname.endsWith("/shared-cgm.csv")) {
    event.respondWith(readSharedCsv());
    return;
  }

  // App shell：network-first，離線時改用快取，確保部署更新後立即生效。
  if (event.request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: url.pathname.endsWith("/") }).then((cached) => cached || caches.match("index.html")))
    );
  }
});

async function handleShare(request) {
  const formData = await request.formData();
  const file = formData.get("csv");
  if (file && typeof file.text === "function") {
    const cache = await caches.open("cgms-share-cache");
    await cache.put("shared-cgm.csv", new Response(await file.text(), {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    }));
  }
  return Response.redirect("./?shared=1", 303);
}

async function readSharedCsv() {
  const cache = await caches.open("cgms-share-cache");
  const cached = await cache.match("shared-cgm.csv");
  if (cached) await cache.delete("shared-cgm.csv");
  return cached || new Response("", { status: 404 });
}
