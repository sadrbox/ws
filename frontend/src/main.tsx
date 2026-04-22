import { createRoot } from 'react-dom/client'
import App from './app'
import { registerServiceWorker } from './services/registerSW'
import { startHealthCheck } from './services/networkStatus'
import { ensureOfflineDb } from './services/offlineDb'

const root = createRoot(document.getElementById('root')!);

// ── Инициализация offline-first инфраструктуры ───────────────────────────
// 1. Открываем IndexedDB (Dexie) — миграции схемы выполняются автоматически
ensureOfflineDb().catch(err => console.error('[OfflineDB] Ошибка инициализации:', err));

// 2. Регистрируем Service Worker — кэширование статики
registerServiceWorker().catch(() => {});

// 3. Запускаем health-check сервера каждые 30 сек
//    При переходе online → автоматический запуск fullSync()
startHealthCheck(30_000);

async function waitForFonts() {
  await Promise.all([
    document.fonts.load('400 16px "PT Sans"'),
    document.fonts.load('700 16px "PT Sans"'),
  ]);
  await document.fonts.ready;
}

waitForFonts().then(() => {
  const rootEl = document.getElementById('root')!;
  rootEl.style.opacity = '0';

  root.render(
    // <StrictMode>
      <App />
    // </StrictMode>,
  );

  // Ждём 2 кадра — React отрендерил, CSS применён, layout стабилен
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      rootEl.style.opacity = '1';
    });
  });
});
