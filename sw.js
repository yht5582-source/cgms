self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(handleShare(event.request));
    return;
  }

  if (event.request.method === "GET" && url.pathname.endsWith("/shared-cgm.csv")) {
    event.respondWith(readSharedCsv());
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
  return cached || new Response("", { status: 404 });
}
