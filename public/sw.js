/* JagX Connect — app-shell + downloaded-video service worker.
 * Lives at /sw.js, separate from /firebase-messaging-sw.js (push).
 *
 * Strategy:
 *  - Navigations: NetworkFirst with cached /index.html fallback when offline.
 *  - Same-origin static assets (js, css, fonts, images): StaleWhileRevalidate.
 *  - Video requests: serve from the "offline-videos" cache first when present,
 *    so videos the user explicitly downloaded play with zero network.
 */

const SHELL_CACHE = "jagx-shell-v1";
const ASSETS_CACHE = "jagx-assets-v1";
const VIDEOS_CACHE = "offline-videos";
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/image-5 (1).jpg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) =>
      Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => undefined))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSETS_CACHE, VIDEOS_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isAsset(url) {
  return /\.(?:js|css|woff2?|ttf|otf|svg|png|jpe?g|webp|gif|ico)$/i.test(url.pathname);
}
function isVideoLike(req) {
  if (req.destination === "video") return true;
  const u = new URL(req.url);
  return /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(u.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Skip auth, analytics, and FCM scope.
  if (url.pathname.startsWith("/firebase-cloud-messaging-push-scope")) return;
  if (url.hostname.includes("google") || url.hostname.includes("doubleclick")) return;

  // Videos: cache-first against the offline-videos bucket. Range requests
  // (Safari) are forwarded to network when not pre-cached.
  if (isVideoLike(req)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VIDEOS_CACHE);
        const hit = await cache.match(req.url, { ignoreSearch: true });
        if (hit && !req.headers.get("range")) return hit;
        try { return await fetch(req); }
        catch { return hit || Response.error(); }
      })(),
    );
    return;
  }

  // Navigations: NetworkFirst with shell fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/index.html", fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  // Same-origin assets: SWR.
  if (url.origin === self.location.origin && isAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS_CACHE);
        const hit = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => undefined);
          return res;
        }).catch(() => null);
        return hit || (await network) || Response.error();
      })(),
    );
  }
});