/**
 * persistenceMode.ts — глобальный реактивный store для режима персистентности.
 *
 * Два режима:
 *   • "offline-first" (по умолчанию) — данные кэшируются в Dexie, мутации
 *     сначала записываются локально, синхронизация с сервером — при наличии сети.
 *   • "transactional" — классический серверный режим. Чтение и запись идут
 *     только на сервер. При отсутствии сети — ошибка, данных из кэша нет.
 *
 * Режим хранится в localStorage и доступен из любого модуля (включая не-React код)
 * через `getMode()`. React-компоненты используют хук `usePersistenceMode()`.
 */

import { useSyncExternalStore } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export type PersistenceMode = "offline-first" | "transactional";

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = "app:persistence-mode";
const DEFAULT_MODE: PersistenceMode = "offline-first";

let currentMode: PersistenceMode = readFromStorage();

const listeners = new Set<() => void>();

function readFromStorage(): PersistenceMode {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw === "offline-first" || raw === "transactional") return raw;
	} catch { /* ignore */ }
	return DEFAULT_MODE;
}

function notify(): void {
	for (const l of listeners) l();
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API (plain JS — для использования вне React)
// ═══════════════════════════════════════════════════════════════════════════

/** Получить текущий режим */
export function getMode(): PersistenceMode {
	return currentMode;
}

/** Переключить режим */
export function setMode(mode: PersistenceMode): void {
	if (mode === currentMode) return;
	currentMode = mode;
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch { /* quota */ }
	notify();
}

/** Переключить на противоположный режим (toggle) */
export function toggleMode(): PersistenceMode {
	const next: PersistenceMode =
		currentMode === "offline-first" ? "transactional" : "offline-first";
	setMode(next);
	return next;
}

/** Является ли текущий режим offline-first? */
export function isOfflineFirst(): boolean {
	return currentMode === "offline-first";
}

// ═══════════════════════════════════════════════════════════════════════════
// REACT HOOK
// ═══════════════════════════════════════════════════════════════════════════

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

function getSnapshot(): PersistenceMode {
	return currentMode;
}

/**
 * React-хук: подписка на текущий режим персистентности.
 * Возвращает `[mode, setMode]`.
 */
export function usePersistenceMode(): [PersistenceMode, typeof setMode] {
	const mode = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MODE);
	return [mode, setMode];
}
