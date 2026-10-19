// Service worker: the offline app shell, nothing else.
//
// - Precaches every file the shell needs (the list and the cache id are written by
//   scripts/build.mjs: the id is a SHA-256 over the path and bytes of every built
//   file, so any change gives a new cache).
// - Serves those files and navigations from this version's cache, so a tab never
//   mixes versions. A new version installs in the background and waits; the page
//   shows "Update available" and sends "skip-waiting" when the viewer reloads.
// - Never touches anything else: no cross-origin request (PeerTube API, video
//   embeds, thumbnails, relays, telemetry hosts) and no same-origin path outside
//   the list (example lists, .well-known/, crash.js, source maps) is intercepted or
//   stored. History lives only in the encrypted vault, never in a cache, so nothing
//   here can leak one profile's viewing to another.
const CACHE = "mf-shell-__BUILD__";
const PRECACHE = "__PRECACHE__";
const SHELL = new Set(PRECACHE.map((p) => new URL(p, self.location.href).href));

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new Request(p, { cache: "reload" })))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mf-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // Any navigation inside the scope gets the shell (query strings carry shortcuts
    // and share-target parameters, which the page reads itself).
    e.respondWith(
      caches.open(CACHE).then((c) => c.match("./index.html").then((hit) => hit || fetch(req))),
    );
    return;
  }
  url.search = "";
  url.hash = "";
  if (!SHELL.has(url.href)) return;
  e.respondWith(caches.open(CACHE).then((c) => c.match(url.href).then((hit) => hit || fetch(req))));
});
