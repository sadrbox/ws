/**
 * registerSW.ts — регистрация Service Worker для offline-кэширования статики.
 *
 * Вызывается из main.tsx или App при старте приложения.
 * SW файл находится в public/sw.js — Vite копирует его в root при сборке.
 */
import { logger } from "src/utils/logger";
import { hasUnsavedWork, hasPendingAppUpdate, applyAppUpdate, setAppUpdateState } from "src/services/appUpdate";

/**
 * Десктоп-бандл Tauri: страница грузится с кастомного протокола (tauri://localhost),
 * вся статика локальна. Service Worker там НЕ нужен и ВРЕДЕН: sw.js на установке
 * делал skipWaiting()+clients.claim(), registerSW на controllerchange —
 * window.location.reload() (до КР-10); под кастомным протоколом Cache-First + смена хешей
 * чанков между сборками дают «Failed to fetch dynamically imported module», которое
 * всплывает в ErrorBoundary вокруг Suspense → «Что-то пошло не так». В вебе (aleppo.kz)
 * SW работает штатно. Поэтому в Tauri SW не регистрируем, а ранее установленный
 * (например, от прежней сборки, уже сломавшей приложение) — снимаем и чистим кэши.
 */
const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Снять все регистрации SW и удалить его кэши (best-effort). */
async function purgeServiceWorkers(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* best-effort: недоступность SW/Cache API не должна ронять старт */
  }
}

/*
 * НОВАЯ ВЕРСИЯ — НЕ ВСЛЕПУЮ (КР-10 аудита 27.09). Раньше новый SW включался сам (skipWaiting), а на
 * controllerchange каждая вкладка перезагружалась: после каждого деплоя пропадали корзина
 * терминала, ввод в окнах и ответ на «Записать», отправленное в ту секунду. Теперь новая версия
 * ждёт, и вкладка обновляется без спроса, только если в ней нет несохранённого (appUpdate.ts:
 * правки и запись форм, корзина, открытое окно) и человек её сейчас не видит — вкладка скрыта или
 * только что открыта (до первых действий). Иначе UIToast показывает «Доступна новая версия» с
 * кнопкой, а скрытие вкладки без несохранённого обновит её само.
 */

/** Столько после загрузки страницы человек ещё ничего не начал: перезагрузка незаметна. */
const FRESH_PAGE_MS = 30_000;
const pageStartedAt = Date.now();

/** Обновиться без спроса можно: несохранённого нет, и вкладка скрыта или только открыта. */
function canReloadQuietly(): boolean {
  if (hasUnsavedWork()) return false;
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  return hidden || Date.now() - pageStartedAt < FRESH_PAGE_MS;
}

let reloading = false;
function reloadOnce(): void {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

// Регистрация — одна на страницу: её зовут и main.tsx, и App, а слушатели не должны удваиваться.
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  registrationPromise ??= doRegister();
  return registrationPromise;
}

async function doRegister(): Promise<ServiceWorkerRegistration | null> {
  // Tauri-бандл: SW отключён. Дополнительно восстанавливаем уже сломанные установки —
  // снимаем старый SW/кэши и, если страница СЕЙЧАС под его контролем, один раз
  // перезагружаемся уже без него (флаг в sessionStorage страхует от петли).
  if (isTauri()) {
    await purgeServiceWorkers();
    try {
      if (navigator.serviceWorker?.controller && !sessionStorage.getItem("__sw_purged")) {
        sessionStorage.setItem("__sw_purged", "1");
        window.location.reload();
      }
    } catch { /* sessionStorage/reload недоступны — игнорируем */ }
    return null;
  }
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  try {
    // Страница уже под SW — смена контроллера означает новую версию. Не под SW — первая смена это
    // первая установка (clients.claim): страница и так свежая, перезагружать нечего.
    let hadController = !!navigator.serviceWorker.controller;
    // Новую версию включила ЭТА вкладка (кнопкой или без спроса) — после включения перезагружаемся.
    let updateRequested = false;

    const activate = (worker: ServiceWorker) => {
      updateRequested = true;
      worker.postMessage({ type: "SKIP_WAITING" });
      // Версию успела сменить ещё более новая (эта уже не включится) — всё равно перезагружаемся:
      // человек нажал «Обновить» или вкладке ничего не грозит.
      setTimeout(reloadOnce, 5_000);
    };
    // Новая версия установлена и ждёт.
    let announced: ServiceWorker | null = null;
    const onWaiting = (worker: ServiceWorker) => {
      if (!navigator.serviceWorker.controller) return; // первая установка: ждать некого, включится сама
      if (announced === worker) return;
      announced = worker;
      logger.info("[SW] Доступна новая версия приложения");
      if (canReloadQuietly()) activate(worker);
      else setAppUpdateState("ready", () => activate(worker));
    };
    const watchInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") onWaiting(worker);
      });
    };

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (updateRequested || canReloadQuietly()) {
        reloadOnce();
        return;
      }
      // Новую версию включила другая вкладка, а здесь есть несохранённое или человек работает:
      // старый код продолжает работать, перезагрузка — по кнопке или когда вкладку скроют.
      setAppUpdateState("activated", reloadOnce);
    });

    // Вкладку скрыли, а обновление ждёт и несохранённого нет — обновляемся без спроса.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      if (hasPendingAppUpdate() && !hasUnsavedWork()) applyAppUpdate();
    });

    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    // Новая версия уже ждёт (установлена раньше, а вкладки так и не обновились) или ставится.
    if (registration.waiting) onWaiting(registration.waiting);
    watchInstalling(registration.installing);
    registration.addEventListener("updatefound", () => watchInstalling(registration.installing));

    logger.info("[SW] Service Worker зарегистрирован:", registration.scope);
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
  logger.info("[SW] Все Service Workers удалены");
}
