import { createRoot } from 'react-dom/client'
import { loadTranslations } from './i18'
// Глобальные keyframes эффектов панелей/вкладок (имена не хешируются — нужны для
// подстановки через CSS-переменные --pane-*-name; см. styles/paneEffects.css).
import './styles/paneEffects.css'
import { registerServiceWorker } from './services/registerSW'
import { startHealthCheck } from './services/networkStatus'
import { ensureOfflineDb } from './services/offlineDb'

const root = createRoot(document.getElementById('root')!);

// ── Глобальный обработчик Escape: убирает фокус с поля ввода ─────────────
// При нажатии Escape, если активный элемент — input/textarea/contenteditable,
// снимаем с него фокус (blur). Capture-фаза используется, чтобы сработать
// раньше локальных обработчиков, которые могут вызвать stopPropagation.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) {
    el.blur();
  }
}, true);

// ── Инициализация offline-first инфраструктуры ───────────────────────────
// 1. Открываем IndexedDB (Dexie) — миграции схемы выполняются автоматически
ensureOfflineDb().catch(err => console.error('[OfflineDB] Ошибка инициализации:', err));

// 2. Регистрируем Service Worker — кэширование статики
registerServiceWorker().catch(() => { });

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

// ── Запуск: сначала словарь активного языка, потом само приложение ────────
// Словари (178 кБ русский, 138 кБ казахский) грузятся отдельными файлами, а не лежат в
// главном чанке: русскому пользователю казахский не нужен вовсе. translate() остаётся
// синхронным, поэтому словарь обязан быть на месте ДО первого рендера — отсюда порядок.
// Само приложение тоже импортируется здесь: раньше оно тянулось статически, и главный
// чанк включал и его, и оба словаря.
async function boot() {
  // ПОРЯДОК ВАЖЕН: словарь ложится ДО того, как вычислятся модули приложения. Часть их
  // вычисляет подписи на месте (например, кнопки тулбара — const ... = translate(...)),
  // и запущенный параллельно import('./app') мог опередить словарь: подписи навсегда
  // остались бы сырыми ключами. Шрифты грузятся рядом — они ни от чего не зависят.
  await Promise.all([loadTranslations(), waitForFonts()]);
  const { default: App } = await import('./app');

  const rootEl = document.getElementById('root')!;
  rootEl.style.opacity = '0';

  root.render(
    <App />
  );

  // Ждём 2 кадра — React отрендерил, CSS применён, layout стабилен
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      rootEl.style.opacity = '1';
    });
  });
}

boot().catch(console.error);
