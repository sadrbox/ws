/**
 * registerSW.ts — регистрация Service Worker для offline-кэширования статики.
 *
 * Вызывается из main.tsx или App при старте приложения.
 * SW файл находится в public/sw.js — Vite копирует его в root при сборке.
 */

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // Новая версия SW установлена — уведомляем пользователя
          console.info("[SW] Доступна новая версия приложения");
          // Автоматически активируем новую версию
          newWorker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    // При активации нового SW — перезагрузить страницу для применения
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    console.info("[SW] Service Worker зарегистрирован:", registration.scope);
    return registration;
  } catch (err) {
    console.error("[SW] Ошибка регистрации Service Worker:", err);
    return null;
  }
}

/**
 * Отправить команду очистки кэшей Service Worker.
 */
export function clearServiceWorkerCache(): void {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_CACHE" });
  }
}

/**
 * Удалить регистрацию Service Worker (для отладки).
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const reg of registrations) {
    await reg.unregister();
  }
  console.info("[SW] Все Service Workers удалены");
}
