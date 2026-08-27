// Подсистема уведомлений панелей (журнал в localStorage + подписки).
// Вынесена из useFormStore.ts (Q9: декомпозиция мега-модуля). Самодостаточна:
// зависит только от React useSyncExternalStore и localStorage, не от form-store.
import { useSyncExternalStore } from "react";

export interface PaneNotificationAction {
	label: string;
	onClick: () => void | Promise<void>;
}

export interface PaneNotification {
	id: number;
	type: "info" | "warning" | "error";
	text: string;
	timestamp: number;
	actions?: PaneNotificationAction[];
	/** Уведомление неактуально (форма сохранена/обновлена) — действия заблокированы */
	resolved?: boolean;
	/** Ссылка на объект-источник уведомления — для перехода к форме документа.
	 *  label — человекочитаемый идентификатор (№/дата или наименование) для ссылки. */
	ref?: { endpoint: string; uuid: string; label?: string };
}

/** Запись в локальном журнале уведомлений (localStorage) */
export interface NotificationJournalEntry {
	id: number;
	type: "info" | "warning" | "error";
	text: string;
	timestamp: number;
	/** Заголовок панели (например «Организации: ТОО Строй-Снаб №1») */
	paneLabel?: string;
	/** Ссылка на объект: endpoint + uuid (+ человекочитаемый label), чтобы можно было переоткрыть */
	ref?: { endpoint: string; uuid: string; label?: string };
}

const JOURNAL_KEY = "notification-journal";
const JOURNAL_MAX = 200;

function loadJournal(): NotificationJournalEntry[] {
	try {
		return JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]") as NotificationJournalEntry[];
	} catch {
		return [];
	}
}

function saveJournal(entries: NotificationJournalEntry[]): void {
	localStorage.setItem(
		JOURNAL_KEY,
		JSON.stringify(entries.slice(-JOURNAL_MAX)),
	);
}

/** Журнал: подписчики для реактивного обновления */
const journalListeners = new Set<() => void>();
let journalCache: NotificationJournalEntry[] | null = null;

function notifyJournalListeners(): void {
	journalCache = null; // сброс кэша
	for (const l of journalListeners) l();
}

function getJournalSnapshot(): NotificationJournalEntry[] {
	if (!journalCache) journalCache = loadJournal();
	return journalCache;
}

function subscribeJournal(listener: () => void): () => void {
	journalListeners.add(listener);
	return () => {
		journalListeners.delete(listener);
	};
}

/** Хук: получить журнал уведомлений (реактивный) */
export function useNotificationJournal(): NotificationJournalEntry[] {
	return useSyncExternalStore(subscribeJournal, getJournalSnapshot, () => []);
}

/** Очистить журнал уведомлений */
export function clearNotificationJournal(): void {
	localStorage.removeItem(JOURNAL_KEY);
	notifyJournalListeners();
}

let nextNoteId = 1;
const paneNotesMap = new Map<string, PaneNotification[]>();
const noteListeners = new Set<() => void>();
let groupsSnapshot: PaneNotificationGroup[] = [];

function notifyNoteListeners(): void {
	groupsSnapshot = paneNotesMap.size === 0
		? emptyGroups
		: Array.from(paneNotesMap.entries()).map(([paneId, notifications]) => ({ paneId, notifications }));
	for (const l of noteListeners) l();
}

/** Добавить уведомление к панели. Также сохраняет в локальный журнал. */
export function addPaneNotification(
	uniqId: string,
	type: PaneNotification["type"],
	text: string,
	/** Контекст для журнала: заголовок панели и ссылка на объект */
	context?: { paneLabel?: string; ref?: { endpoint: string; uuid: string; label?: string } },
	/** Кнопки-действия внутри уведомления */
	actions?: PaneNotificationAction[],
): void {
	const ts = Date.now();
	const id = nextNoteId++;
	const list = paneNotesMap.get(uniqId) ?? [];
	list.push({ id, type, text, timestamp: ts, actions, ref: context?.ref });
	paneNotesMap.set(uniqId, list);
	notifyNoteListeners();

	// Сохраняем в журнал localStorage
	const journal = loadJournal();
	journal.push({
		id,
		type,
		text,
		timestamp: ts,
		paneLabel: context?.paneLabel,
		ref: context?.ref,
	});
	saveJournal(journal);
	notifyJournalListeners();

	// Показываем всплывающий тост
	const toastType =
		type === "error"
			? "error"
			: type === "warning"
				? "warning"
				: type === "info"
					? "info"
					: "success";
	window.dispatchEvent(
		new CustomEvent("ui_toast", {
			detail: { message: text, type: toastType, title: context?.paneLabel },
		}),
	);
}

/** Удалить конкретное уведомление */
export function dismissPaneNotification(uniqId: string, noteId: number): void {
	const list = paneNotesMap.get(uniqId);
	if (!list) return;
	const filtered = list.filter((n) => n.id !== noteId);
	if (filtered.length === 0) paneNotesMap.delete(uniqId);
	else paneNotesMap.set(uniqId, filtered);
	notifyNoteListeners();
}

/** Удалить из панели «сетевые» уведомления (offline/нет связи/локальный кэш).
 *  Вызывается после успешного online-обращения к серверу, чтобы стальные
 *  предупреждения не вводили пользователя в заблуждение. */
export function dismissNetworkNotifications(uniqId: string): void {
	const list = paneNotesMap.get(uniqId);
	if (!list || list.length === 0) return;
	const NETWORK_RE =
		/Нет связи с сервером|режиме offline|локального кэша|Сохранено локально/i;
	const filtered = list.filter((n) => !NETWORK_RE.test(n.text));
	if (filtered.length === list.length) return;
	if (filtered.length === 0) paneNotesMap.delete(uniqId);
	else paneNotesMap.set(uniqId, filtered);
	notifyNoteListeners();
}

/** Очистить все Уведомления */
export function clearPaneNotifications(uniqId: string): void {
	if (paneNotesMap.has(uniqId)) {
		paneNotesMap.delete(uniqId);
		notifyNoteListeners();
	}
}

/** Пометить все Уведомления как неактуальные (resolved).
 *  Уведомления остаются видимыми, но действия (кнопки) блокируются. */
export function resolvePaneNotifications(uniqId: string): void {
	const list = paneNotesMap.get(uniqId);
	if (!list || list.length === 0) return;
	let changed = false;
	for (const n of list) {
		if (!n.resolved) {
			n.resolved = true;
			changed = true;
		}
	}
	if (changed) notifyNoteListeners();
}

function subscribeNotes(listener: () => void): () => void {
	noteListeners.add(listener);
	return () => {
		noteListeners.delete(listener);
	};
}

/** Хук: уведомления конкретной панели */
export function usePaneNotifications(uniqId: string): PaneNotification[] {
	return useSyncExternalStore(
		subscribeNotes,
		() => paneNotesMap.get(uniqId) ?? emptyNotes,
		() => emptyNotes,
	);
}

export interface PaneNotificationGroup {
	paneId: string;
	notifications: PaneNotification[];
}

const emptyGroups: PaneNotificationGroup[] = [];

/** Хук: уведомления всех панелей сгруппированные по paneId. */
export function useAllPaneNotifications(): PaneNotificationGroup[] {
	return useSyncExternalStore(
		subscribeNotes,
		() => groupsSnapshot,
		() => emptyGroups,
	);
}

const emptyNotes: PaneNotification[] = [];
