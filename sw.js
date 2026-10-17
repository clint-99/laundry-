// App shell only: never cache API responses, auth traffic, or customer records.
const VERSION = "laundry-shell-v3";
const root = new URL("./", self.location.href);
const paths = [
  "owner/",
  "rider/",
  "owner/owner.js",
  "owner/operations.js",
  "owner/workspace.js",
  "rider/rider.js",
  "shared/config.js",
  "shared/h.js",
  "shared/ui.js",
  "shared/ui.css",
  "shared/utils.js",
  "shared/api.js",
  "icons/basket.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];
const shell = new Set(paths.map((path) => new URL(path, root).href));
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll([...shell])),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("laundry-shell-") && key !== VERSION,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !shell.has(event.request.url)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok)
          caches
            .open(VERSION)
            .then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
