/**
 * networkStatus — сервис отслеживания состояния сети + интеграция с syncManager.
 *
 * Ключевые принципы:
 *  - НЕ спамить запросы при оффлайне (exponential backoff)
 *  - Сначала проверять navigator.onLine, и только если true — делать ping
 *  - При переходе online → автозапуск syncManager.fullSync()
 *  - Единая очередь изменений через _pendingChanges в Dexie (offlineDb)
 *
 * Подписки:
 *  - subscribeNetwork(listener) — уведомление при смене online/offline
 *  - subscribeSyncStatus(listener) — уведомление при смене статуса синхронизации
 */

import apiClient from "src/services/api/client";

// ═══════════════════════════════════════════════════════════════════════════
// ONLINE / OFFLINE STATE
// ═══════════════════════════════════════════════════════════════════════════

type Listener = () => void;
const networkListeners = new Set<Listener>();

let _isOnline: boolean = navigator.onLine;

/** Счётчик последовательных неудачных health-check */
let _consecutiveFailures = 0;

function notifyNetwork(): void {
	for (const l of networkListeners) l();
}

export function subscribeNetwork(listener: Listener): () => void {
	networkListeners.add(listener);
	return () => {
		networkListeners.delete(listener);
	};
}

export function getIsOnline(): boolean {
	return _isOnline;
}

// Инициализация при импорте
function handleOnline(): void {
	if (_isOnline) return;
	_isOnline = true;
	_consecutiveFailures = 0;
	notifyNetwork();
	console.info("[Network] 🟢 Онлайн — запуск синхронизации");
	// Автоматический запуск синхронизации через syncManager
	triggerSync().catch(() => {});
}
function handleOffline(): void {
	if (!_isOnline) return;
	_isOnline = false;
	notifyNetwork();
	console.info("[Network] 🔴 Оффлайн — работаем локально");
}

window.addEventListener("online", handleOnline);
window.addEventListener("offline", handleOffline);

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH-CHECK с intelligent backoff
// ═══════════════════════════════════════════════════════════════════════════

let healthCheckTimer: ReturnType<typeof setTimeout> | null = null;

/** Базовый интервал (передаётся в startHealthCheck) */
let _baseInterval = 30_000;

/**
 * Вычисляет следующий интервал с exponential backoff:
 *  - Если онлайн: используем базовый интервал
 *  - Если оффлайн: backoff до макс. 5 мин (base * 2^failures, cap 300s)
 */
function getNextInterval(): number {
	if (_isOnline && _consecutiveFailures === 0) return _baseInterval;
	const backoff = Math.min(
		_baseInterval * Math.pow(2, _consecutiveFailures),
		300_000,
	);
	return backoff;
}

/** Запланировать следующую проверку */
function scheduleNextCheck(): void {
	if (healthCheckTimer) clearTimeout(healthCheckTimer);
	const interval = getNextInterval();
	healthCheckTimer = setTimeout(() => void doHealthCheck(), interval);
}

async function doHealthCheck(): Promise<void> {
	// 1. Быстрая проверка: если navigator.onLine = false → не делаем запрос
	if (!navigator.onLine) {
		if (_isOnline) handleOffline();
		_consecutiveFailures++;
		scheduleNextCheck();
		return;
	}

	// 2. Реальный ping к API (через fetch вместо axios — меньше шума в консоли)
	try {
		const base = apiClient.defaults.baseURL || "/api/v1";
		const healthUrl = base.replace(/\/v1\/?$/, "/health");
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000);

		const res = await fetch(healthUrl, {
			method: "HEAD",
			signal: controller.signal,
			// Не добавляем credentials/headers — минимальный ping
		});
		clearTimeout(timeoutId);

		if (res.ok || res.status === 204) {
			// Успех — сервер доступен
			_consecutiveFailures = 0;
			if (!_isOnline) handleOnline();
		} else {
			// Сервер ответил, но с ошибкой (4xx/5xx) — всё равно "онлайн" (связь есть)
			_consecutiveFailures = 0;
			if (!_isOnline) handleOnline();
		}
	} catch {
		// Неудача — сервер недоступен
		_consecutiveFailures++;
		// Не переключаемся в offline сразу при одном сбое — нужно 2+ подряд
		if (_consecutiveFailures >= 2 && _isOnline) {
			handleOffline();
		}
	}

	scheduleNextCheck();
}

export function startHealthCheck(intervalMs = 30_000): void {
	stopHealthCheck();
	_baseInterval = intervalMs;
	_consecutiveFailures = 0;
	// Первую проверку делаем сразу (через 0ms), чтобы быстро определить
	// доступность сервера ДО того, как UI начнёт слать запросы
	void doHealthCheck();
}

export function stopHealthCheck(): void {
	if (healthCheckTimer) {
		clearTimeout(healthCheckTimer);
		healthCheckTimer = null;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC STATUS
// ═══════════════════════════════════════════════════════════════════════════

let isSyncing = false;

const syncListeners = new Set<Listener>();

export function subscribeSyncStatus(listener: Listener): () => void {
	syncListeners.add(listener);
	return () => {
		syncListeners.delete(listener);
	};
}

function notifySyncStatus(): void {
	for (const l of syncListeners) l();
}

export function getIsSyncing(): boolean {
	return isSyncing;
}

/**
 * Запустить полную синхронизацию через syncManager.
 * Вызывается автоматически при переходе в online, или вручную из UI.
 */
export async function triggerSync(): Promise<void> {
	if (isSyncing || !_isOnline) return;
	isSyncing = true;
	notifySyncStatus();

	try {
		const { fullSync } = await import("./syncManager");
		await fullSync();
	} catch (err) {
		console.error("[NetworkStatus] Sync failed:", err);
	} finally {
		isSyncing = false;
		notifySyncStatus();
	}
}

/**
 * @deprecated Используйте triggerSync(). Оставлено для обратной совместимости.
 */
export async function processQueue(): Promise<any> {
	await triggerSync();
	// Возвращаем совместимый формат
	const { getPendingChangesCount } = await import("./offlineDb");
	const pending = await getPendingChangesCount();
	return {
		pending,
		syncing: 0,
		synced: 0,
		failed: 0,
		conflict: 0,
		total: pending,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFLICT RESOLUTION (делегируем syncManager)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Принять локальную версию — повторить запрос.
 */
export async function resolveConflictLocal(conflict: any): Promise<boolean> {
	try {
		const { resolveConflictKeepLocal } = await import("./syncManager");
		return await resolveConflictKeepLocal(conflict);
	} catch (err) {
		console.error("[NetworkStatus] resolveConflictLocal failed:", err);
		return false;
	}
}

/**
 * Принять серверную версию — обновить локальную.
 */
export async function resolveConflictServer(conflict: any): Promise<boolean> {
	try {
		const { resolveConflictKeepServer } = await import("./syncManager");
		return await resolveConflictKeepServer(conflict);
	} catch (err) {
		console.error("[NetworkStatus] resolveConflictServer failed:", err);
		return false;
	}
}
