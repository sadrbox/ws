/**
 * НОВАЯ ВЕРСИЯ ПРИЛОЖЕНИЯ — БЕЗ ПЕРЕЗАГРУЗКИ ВСЛЕПУЮ (КР-10 аудита 27.09).
 *
 * sw.js меняется на каждой сборке (версия в имени кэша), и раньше новый Service Worker сам
 * активировался, а все открытые вкладки перезагружались без спроса: пропадали корзина терминала,
 * ввод в окнах и мастерах, ответ на «Записать», отправленное в эту секунду. Теперь новая версия
 * ждёт (registerSW.ts): без спроса вкладка обновляется, только когда в ней нет несохранённого, иначе
 * UIToast показывает «Доступна новая версия» с кнопкой.
 *
 * Модуль нарочно без React и тяжёлых импортов: его берут и registerSW (грузится до приложения), и
 * формы, и терминал, и UIToast.
 */

/** none — обновлений нет; ready — новая версия установлена и ждёт; activated — её включила другая вкладка. */
export type AppUpdateState = "none" | "ready" | "activated";

// ── Несохранённое: кто мешает перезагрузке ─────────────────────────────────

type ReloadBlocker = () => boolean;
const blockers = new Set<ReloadBlocker>();

/**
 * Зарегистрировать проверку «есть несохранённое» (формы с правками или записью в пути, корзина
 * терминала). Возвращает снятие регистрации.
 */
export function registerReloadBlocker(fn: ReloadBlocker): () => void {
	blockers.add(fn);
	return () => {
		blockers.delete(fn);
	};
}

/** Есть ли во вкладке то, что перезагрузка потеряет. */
export function hasUnsavedWork(): boolean {
	for (const fn of blockers) {
		try {
			if (fn()) return true;
		} catch {
			return true; // не смогли проверить — считаем, что есть
		}
	}
	// Открытое модальное окно: ввод в нём (мастера 1С, загрузки, подтверждения) нигде не хранится.
	try {
		if (typeof document !== "undefined" && document.querySelector('[data-modal-root="true"]')) return true;
	} catch {
		/* нет DOM */
	}
	return false;
}

// ── Состояние обновления (для UIToast) ─────────────────────────────────────

let state: AppUpdateState = "none";
let dismissed = false;
let applier: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of listeners) l();
}

/** registerSW: новая версия ждёт (ready) или уже включена (activated); apply — как обновиться. */
export function setAppUpdateState(next: AppUpdateState, apply: (() => void) | null): void {
	state = next;
	applier = apply;
	dismissed = false;
	emit();
}

/** Что показывать: закрытое крестиком уведомление не показываем до следующей новости. */
export function getAppUpdateState(): AppUpdateState {
	return dismissed ? "none" : state;
}

/** Ждёт ли обновление применения — независимо от того, закрыто ли уведомление. */
export function hasPendingAppUpdate(): boolean {
	return state !== "none";
}

export function subscribeAppUpdate(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Закрыть уведомление (обновление по-прежнему ждёт удобного момента). */
export function dismissAppUpdate(): void {
	dismissed = true;
	emit();
}

/** Обновиться сейчас (кнопка уведомления). */
export function applyAppUpdate(): void {
	if (applier) applier();
	else window.location.reload();
}

/** Сброс — для тестов. */
export function resetAppUpdateForTests(): void {
	blockers.clear();
	listeners.clear();
	state = "none";
	dismissed = false;
	applier = null;
}
