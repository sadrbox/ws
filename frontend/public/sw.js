/**
 * Service Worker для кэширования статических ресурсов.
 *
 * Стратегия:
 *  - HTML / index.html → Network First (fallback на кэш)
 *  - JS / CSS / fonts  → Cache First (быстро из кэша, обновление в фоне)
 *  - Images            → Cache First с лимитом
 *  - API               → Network Only (данные через syncManager)
 */

/// <reference lib="webworker" />

const CACHE_NAME = "app-static-v1";
const RUNTIME_CACHE = "app-runtime-v1";

/**
 * Ресурсы, которые кэшируем при установке (precache).
 * Vite генерирует хэшированные имена — они уникальны.
 */
const PRECACHE_URLS = [
  "/",
  "/index.html",
];

// ═══════════════════════════════════════════════════════════════════════════
// INSTALL — precache основных ресурсов
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.info("[SW] Precaching static assets");
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      return self.skipWaiting();
    }),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVATE — очистка старых кэшей
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener("activate", (event) => {
  const currentCaches = new Set([CACHE_NAME, RUNTIME_CACHE]);
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => !currentCaches.has(name))
          .map((name) => {
            console.info(`[SW] Удаление старого кэша: ${name}`);
            return caches.delete(name);
          }),
      ),
    ).then(() => {
      return self.clients.claim();
    }),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// FETCH — стратегии кэширования
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Пропускаем:
  // - не-GET запросы
  // - API запросы (данные синхронизируются через syncManager)
  // - WebSocket
  // - chrome-extension и прочее
  if (
    event.request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.protocol === "ws:" ||
    url.protocol === "wss:" ||
    !url.protocol.startsWith("http")
  ) {
    return;
  }

  // ── HTML: Network First ──
  if (
    event.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html")
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ── JS / CSS / шрифты: Cache First (Stale-While-Revalidate) ──
  if (
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|eot)$/) ||
    url.pathname.includes("/assets/")
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── Изображения: Cache First ──
  if (url.pathname.match(/\.(png|jpe?g|gif|svg|webp|ico|avif)$/)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── Остальное: Network First ──
  event.respondWith(networkFirst(event.request));
});

// ═══════════════════════════════════════════════════════════════════════════
// Стратегии
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Network First — пробуем сеть, при ошибке — кэш.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Сохраняем в кэш
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Для навигации — возвращаем закэшированный index.html (SPA)
    if (request.mode === "navigate") {
      const fallback = await caches.match("/index.html");
      if (fallback) return fallback;
    }
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

/**
 * Cache First — пробуем кэш, при промахе — сеть + сохранение в кэш.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE — обработка сообщений от клиента
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CLEAR_CACHE") {
    caches.keys().then((names) =>
      Promise.all(names.map((n) => caches.delete(n))),
    ).then(() => {
      console.info("[SW] Все кэши очищены");
    });
  }
});
