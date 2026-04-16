import {
	useCallback,
	useRef,
	useSyncExternalStore,
	useEffect,
} from "react";
import { useAppContext } from "src/app";
import { isNetworkError } from "src/services/networkUtils";
import { commitPendingRows } from "src/services/commitPendingRows";
import { pipeFetchOne, pipeCreate, pipeUpdate, isOfflineFirst } from "src/services/persistencePipe";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import useUID from "./useUID";

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

/** Описание одной вложенной таблицы */
export interface TableDef {
	/** API endpoint SubTable (например "contacts", "saleitems") */
	endpoint: string;
	/** FK-поле, связывающее строки с родителем (например "ownerUuid") */
	parentField: string;
	/** Человекочитаемое имя (для ошибок) */
	label: string;
	/** Доп. поля, добавляемые к каждому payload (например { ownerType: "organization" }) */
	extraFields?: Record<string, unknown>;
	/** Кастомные payload-функции */
	createPayload?: (row: TDataItem) => Record<string, unknown>;
	updatePayload?: (row: TDataItem) => Record<string, unknown>;
	extraSkipFields?: string[];
}

/** Описание полей формы: ключ → значение по умолчанию */
export type FieldDefs<F extends object> = {
	[K in keyof F]: F[K];
};

/** Данные одной вложенной таблицы в store */
export interface TableState {
	/** Строки с _pendingAction (create | update | delete) */
	pending: TDataItem[];
}

/** Полное состояние формы */
export interface FormStoreState<F extends object> {
	fields: F;
	tables: Record<string, TableState>;
	meta: {
		uuid: string | undefined;
		endpoint: string;
		isLoading: boolean;
		isEditMode: boolean;
		error: string | null;
		errorRevision: number;
	};
}

/** Тип подписки */
type Listener = () => void;

// ═══════════════════════════════════════════════════════════════════════════
// PERSIST (sessionStorage)
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_PREFIX = "formStore:";

function persistToSession<F extends object>(
	storageKey: string,
	state: FormStoreState<F>,
): void {
	try {
		// Сохраняем только fields + tables (meta не нужна)
		const payload = { fields: state.fields, tables: state.tables };
		sessionStorage.setItem(storageKey, JSON.stringify(payload));
	} catch {
		/* quota exceeded */
	}
}

function restoreFromSession<F extends object>(
	storageKey: string,
): { fields: F; tables: Record<string, TableState> } | null {
	try {
		const raw = sessionStorage.getItem(storageKey);
		if (!raw) return null;
		return JSON.parse(raw) as { fields: F; tables: Record<string, TableState> };
	} catch {
		return null;
	}
}

function clearSession(storageKey: string): void {
	try {
		sessionStorage.removeItem(storageKey);
	} catch {
		/* ignore */
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE STORE (чистый JS, без React)
// ═══════════════════════════════════════════════════════════════════════════

function createFormStore<F extends object>(
	defaultFields: F,
	tableDefs: Record<string, TableDef>,
	endpoint: string,
	uuid: string | undefined,
	storageKey: string,
) {
	// Мутабельный ключ — может измениться после первого save (new → uuid)
	let currentStorageKey = storageKey;

	// ── Начальное состояние ──
	const emptyTables: Record<string, TableState> = {};
	for (const key of Object.keys(tableDefs)) {
		emptyTables[key] = { pending: [] };
	}

	let state: FormStoreState<F> = {
		fields: { ...defaultFields },
		tables: emptyTables,
		meta: {
			uuid,
			endpoint,
			isLoading: false,
			isEditMode: !!uuid,
			error: null,
			errorRevision: 0,
		},
	};

	// Пробуем восстановить из sessionStorage
	let hadStoredData = false;
	const restored = restoreFromSession<F>(currentStorageKey);
	if (restored) {
		state.fields = { ...defaultFields, ...restored.fields };
		// Восстанавливаем tables, но только те, которые определены в tableDefs
		for (const key of Object.keys(tableDefs)) {
			if (restored.tables?.[key]) {
				state.tables[key] = restored.tables[key];
			}
		}
		hadStoredData = true;
	}

	// snapshotReady = false пока серверный snapshot не загружен (при hadStoredData).
	// Блокирует isDirty() чтобы не мерцал индикатор «Не сохранено».
	let snapshotReady = !hadStoredData;

	// ── Подписчики ──
	const listeners = new Set<Listener>();

	function notify(): void {
		for (const l of listeners) l();
	}

	function subscribe(listener: Listener): () => void {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function getSnapshot(): FormStoreState<F> {
		return state;
	}

	// ── Debounced persist ──
	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	function schedulePersist(): void {
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistToSession(currentStorageKey, state);
		}, 300);
	}

	// ── Мутации ──

	/** Обновить одно поле формы */
	function setField<K extends keyof F>(field: K, value: F[K]): void {
		if (state.fields[field] === value) return;
		state = {
			...state,
			fields: { ...state.fields, [field]: value },
		};
		notify();
		schedulePersist();
	}

	/** Обновить несколько полей формы за раз */
	function setFields(patch: Partial<F>): void {
		state = {
			...state,
			fields: { ...state.fields, ...patch },
		};
		notify();
		schedulePersist();
	}

	/** Заменить все поля формы целиком */
	function replaceFields(fields: F): void {
		state = { ...state, fields };
		notify();
		schedulePersist();
	}

	// ── Dirty tracking ──────────────────────────────────────────────────
	// savedSnapshot хранит JSON-строку «чистого» состояния (после load / save).
	// isDirty() сравнивает текущее состояние с последним сохранённым.
	// ⚠️ Инициализация = начальные defaults + пустые таблицы (ДО восстановления из sessionStorage).
	// Если данные были восстановлены из session — isDirty() вернёт true, что корректно.
	let savedSnapshot: string = JSON.stringify({
		fields: defaultFields,
		tables: emptyTables,
	});

	/** Сбросить dirty-флаг (вызывать после load / save) */
	function markClean(): void {
		savedSnapshot = JSON.stringify({
			fields: state.fields,
			tables: state.tables,
		});
		snapshotReady = true;
		notify(); // Уведомить подписчиков (dirty-индикатор на вкладке)
	}

	/** Есть ли несохранённые изменения? */
	function isDirty(): boolean {
		// Пока серверный snapshot не загружен — не показывать dirty
		if (!snapshotReady) return false;
		const current = JSON.stringify({
			fields: state.fields,
			tables: state.tables,
		});
		return current !== savedSnapshot;
	}

	/** Обновить pending-строки вложенной таблицы */
	function setTablePending(tableKey: string, pending: TDataItem[]): void {
		const prev = state.tables[tableKey];
		if (!prev) return;
		state = {
			...state,
			tables: {
				...state.tables,
				[tableKey]: { ...prev, pending },
			},
		};
		notify();
		schedulePersist();
	}

	/** Очистить pending одной таблицы */
	function clearTablePending(tableKey: string): void {
		setTablePending(tableKey, []);
	}

	/** Очистить pending всех таблиц */
	function clearAllTablesPending(): void {
		const next: Record<string, TableState> = {};
		for (const key of Object.keys(state.tables)) {
			next[key] = { pending: [] };
		}
		state = { ...state, tables: next };
		notify();
		schedulePersist();
	}

	/** Обновить meta-поля */
	function setMeta(patch: Partial<FormStoreState<F>["meta"]>): void {
		state = {
			...state,
			meta: { ...state.meta, ...patch },
		};
		notify();
	}

	/** Установить ошибку (с инкрементом revision для перемонтирования FormError) */
	function setError(msg: string | null): void {
		setMeta({
			error: msg,
			errorRevision: msg
				? state.meta.errorRevision + 1
				: state.meta.errorRevision,
		});
	}

	// ── API ──

	/**
	 * Загрузить данные сущности с сервера.
	 * @param snapshotOnly — если true, НЕ заменять текущие fields/tables,
	 *   а только обновить savedSnapshot серверными данными (для корректного isDirty).
	 *   Используется когда fields восстановлены из sessionStorage.
	 */
	async function load(
		entityUuid: string,
		mapServerToForm: (data: any, prev?: F) => F | Promise<F>,
		afterLoad?: () => void,
		snapshotOnly = false,
		paneUniqId?: string,
	): Promise<void> {
		setMeta({ isLoading: true });
		setError(null);
		try {
			let d: any;
			let fromCache = false;

			if (isOfflineFirst()) {
				// ── Offline-first pipe: server → Dexie fallback ──
				const result = await pipeFetchOne(endpoint, entityUuid);
				if (result) {
					d = result.item;
					fromCache = result.fromCache;
				} else {
					throw new Error("Запись не найдена");
				}
			} else {
				// ── Transactional pipe: только сервер ──
				const result = await pipeFetchOne(endpoint, entityUuid);
				if (result) {
					d = result.item;
					fromCache = false;
				} else {
					throw new Error("Запись не найдена");
				}
			}

			const mapped = await Promise.resolve(
				mapServerToForm(d, state.fields),
			);

			if (snapshotOnly) {
				savedSnapshot = JSON.stringify({
					fields: mapped,
					tables: emptyTables,
				});
				snapshotReady = true;
				setMeta({ isLoading: false, isEditMode: true, uuid: entityUuid });
				notify();
			} else {
				replaceFields(mapped);
				clearAllTablesPending();
				setMeta({ isLoading: false, isEditMode: true, uuid: entityUuid });
				markClean();
			}

			if (fromCache) {
				const cacheMsg = "Данные загружены из локального кэша (offline-режим).";
				setError(cacheMsg);
				if (paneUniqId) addPaneNotification(paneUniqId, "info", cacheMsg);
			}

			afterLoad?.();
		} catch (err: any) {
			if (isNetworkError(err)) {
				const offMsg = "Нет связи с сервером. Работа в режиме offline — данные будут загружены при восстановлении соединения.";
				setError(offMsg);
				if (paneUniqId) addPaneNotification(paneUniqId, "warning", offMsg);
			} else {
				setError(
					err.response?.data?.message ||
						"Не удалось загрузить данные",
				);
			}
			setMeta({ isLoading: false });
		}
	}

	/** Сохранить поля формы на сервере (POST или PUT) */
	async function submitFields(
		buildPayload: (fields: F) => Record<string, unknown> | string,
		mapServerToForm: (data: any, prev?: F) => F | Promise<F>,
		buildPaneLabel: (saved: any) => string,
		updatePaneLabel: (uniqId: string, label: string) => void,
		uniqId?: string,
	): Promise<{ success: boolean; savedData?: any }> {
		setMeta({ isLoading: true });
		setError(null);

		const payloadOrError = buildPayload(state.fields);
		if (typeof payloadOrError === "string") {
			setError(payloadOrError);
			setMeta({ isLoading: false });
			return { success: false };
		}

		try {
			const isEdit =
				state.meta.isEditMode &&
				(state.meta.uuid || (state.fields as any).uuid);
			const entityUuid =
				state.meta.uuid || (state.fields as any).uuid;

			let saved: any;
			let wasOffline = false;

			if (isEdit && entityUuid) {
				const result = await pipeUpdate(endpoint, entityUuid, payloadOrError as Record<string, unknown>);
				saved = result.item;
				wasOffline = result.offline;
			} else {
				const result = await pipeCreate(endpoint, payloadOrError as Record<string, unknown>);
				saved = result.item;
				wasOffline = result.offline;
			}

			const mapped = await Promise.resolve(
				mapServerToForm(saved, state.fields),
			);
			replaceFields(mapped);
			setMeta({
				isLoading: false,
				isEditMode: true,
				uuid: saved.uuid ?? entityUuid,
			});

			if (wasOffline) {
				const saveMsg = "Сохранено локально. Синхронизация произойдёт при восстановлении связи.";
				setError(saveMsg);
				if (uniqId) addPaneNotification(uniqId, "info", saveMsg);
			}

			if (uniqId) updatePaneLabel(uniqId, buildPaneLabel(saved));
			return { success: true, savedData: saved };
		} catch (err: any) {
			let msg = "Не удалось сохранить";
			if (isNetworkError(err))
				msg = "Нет связи с сервером. Повторите попытку при восстановлении соединения.";
			else if (err.response?.status === 409)
				msg = err.response.data?.message || "Запись уже существует";
			else if (err.response?.status === 400)
				msg = err.response.data?.message || "Ошибка валидации";
			else if (err.message) msg = err.message;
			setError(msg);
			if (uniqId && isNetworkError(err)) addPaneNotification(uniqId, "warning", msg);
			setMeta({ isLoading: false });
			return { success: false };
		}
	}

	/** Коммит pending-строк всех вложенных таблиц на сервер */
	async function commitAllTables(parentUuid: string): Promise<void> {
		for (const [key, tableDef] of Object.entries(tableDefs)) {
			const { pending } = state.tables[key];
			if (!pending.length) continue;
			await commitPendingRows(
				tableDef.endpoint,
				pending,
				parentUuid,
				tableDef.parentField,
				tableDef.label,
				{
					createPayload: tableDef.createPayload,
					updatePayload: tableDef.updatePayload,
					extraSkipFields: tableDef.extraSkipFields,
					extraFields: tableDef.extraFields,
				},
			);
		}
		clearAllTablesPending();
	}

	/** Коммит pending-строк одной конкретной таблицы */
	async function commitTable(
		tableKey: string,
		parentUuid: string,
	): Promise<void> {
		const tableDef = tableDefs[tableKey];
		if (!tableDef) return;
		const { pending } = state.tables[tableKey];
		if (!pending.length) return;
		await commitPendingRows(
			tableDef.endpoint,
			pending,
			parentUuid,
			tableDef.parentField,
			tableDef.label,
			{
				createPayload: tableDef.createPayload,
				updatePayload: tableDef.updatePayload,
				extraSkipFields: tableDef.extraSkipFields,
				extraFields: tableDef.extraFields,
			},
		);
		clearTablePending(tableKey);
	}

	/** Полная очистка (sessionStorage + reset state) */
	function destroy(): void {
		if (persistTimer) clearTimeout(persistTimer);
		clearSession(currentStorageKey);
		listeners.clear();
	}

	/**
	 * Миграция storageKey (после первого POST: new → uuid).
	 * Удаляет старый ключ из sessionStorage, обновляет текущий, сохраняет state.
	 */
	function migrateStorageKey(newKey: string): void {
		if (newKey === currentStorageKey) return;
		clearSession(currentStorageKey);
		storeCache.delete(currentStorageKey);
		currentStorageKey = newKey;
		storeCache.set(newKey, storeResult as any);
		schedulePersist();
	}

	/** Получить текущий storageKey (для внешних операций с кэшем) */
	function getStorageKey(): string {
		return currentStorageKey;
	}

	const storeResult = {
		// Подписка
		subscribe,
		getSnapshot,
		hadStoredData,

		// Мутации fields
		setField,
		setFields,
		replaceFields,

		// Мутации tables
		setTablePending,
		clearTablePending,
		clearAllTablesPending,

		// Meta
		setMeta,
		setError,

		// API
		load,
		submitFields,
		commitAllTables,
		commitTable,

		// Dirty tracking
		isDirty,
		markClean,

		// Storage key migration
		migrateStorageKey,
		getStorageKey,

		// Cleanup
		destroy,
		clearStorage: () => {
			// Отменяем отложенную запись, чтобы она не перезаписала очищенные данные
			if (persistTimer) {
				clearTimeout(persistTimer);
				persistTimer = null;
			}
			clearSession(currentStorageKey);
		},
	};

	return storeResult;
}

/** Тип store, возвращаемого createFormStore */
export type FormStore<F extends object> = ReturnType<
	typeof createFormStore<F>
>;

// ═══════════════════════════════════════════════════════════════════════════
// КЭШИРОВАНИЕ STORE (синглтон на storageKey)
// ═══════════════════════════════════════════════════════════════════════════

const storeCache = new Map<string, FormStore<any>>();

// ═══════════════════════════════════════════════════════════════════════════
// DIRTY PANES STORE — глобальный реактивный Set<uniqId> для индикации
// несохранённых изменений на вкладках. Использует useSyncExternalStore.
// ═══════════════════════════════════════════════════════════════════════════

const dirtySet = new Set<string>();
const dirtyListeners = new Set<() => void>();

function notifyDirtyListeners(): void {
	for (const l of dirtyListeners) l();
}

/** Пометить панель как dirty/clean. Вызывается из useFormStore при мутациях. */
export function setPaneDirty(uniqId: string, dirty: boolean): void {
	const had = dirtySet.has(uniqId);
	if (dirty && !had) {
		dirtySet.add(uniqId);
		notifyDirtyListeners();
	} else if (!dirty && had) {
		dirtySet.delete(uniqId);
		notifyDirtyListeners();
	}
}

function subscribeDirty(listener: () => void): () => void {
	dirtyListeners.add(listener);
	return () => { dirtyListeners.delete(listener); };
}

/** Хук: подписка на dirty-состояние конкретной панели. */
export function usePaneDirty(uniqId: string): boolean {
	return useSyncExternalStore(
		subscribeDirty,
		() => dirtySet.has(uniqId),
		() => false,
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// PANE NOTIFICATIONS — уведомления привязанные к конкретной панели.
// Используется для информирования пользователя о состоянии формы
// (например: «данные восстановлены из предыдущей сессии»).
// ═══════════════════════════════════════════════════════════════════════════

export interface PaneNotificationAction {
	label: string;
	onClick: () => void;
}

export interface PaneNotification {
	id: number;
	type: "info" | "warning";
	text: string;
	timestamp: number;
	actions?: PaneNotificationAction[];
}

/** Запись в локальном журнале уведомлений (localStorage) */
export interface NotificationJournalEntry {
	id: number;
	type: "info" | "warning";
	text: string;
	timestamp: number;
	/** Заголовок панели (например «Организации: ТОО Строй-Снаб №1») */
	paneLabel?: string;
	/** Ссылка на объект: endpoint + uuid, чтобы можно было переоткрыть */
	ref?: { endpoint: string; uuid: string };
}

const JOURNAL_KEY = "notification-journal";
const JOURNAL_MAX = 200;

function loadJournal(): NotificationJournalEntry[] {
	try {
		return JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
	} catch { return []; }
}

function saveJournal(entries: NotificationJournalEntry[]): void {
	localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries.slice(-JOURNAL_MAX)));
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
	return () => { journalListeners.delete(listener); };
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

function notifyNoteListeners(): void {
	for (const l of noteListeners) l();
}

/** Добавить уведомление к панели. Также сохраняет в локальный журнал. */
export function addPaneNotification(
	uniqId: string,
	type: PaneNotification["type"],
	text: string,
	/** Контекст для журнала: заголовок панели и ссылка на объект */
	context?: { paneLabel?: string; ref?: { endpoint: string; uuid: string } },
	/** Кнопки-действия внутри уведомления */
	actions?: PaneNotificationAction[],
): void {
	const ts = Date.now();
	const id = nextNoteId++;
	const list = paneNotesMap.get(uniqId) ?? [];
	list.push({ id, type, text, timestamp: ts, actions });
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

/** Очистить все уведомления панели */
export function clearPaneNotifications(uniqId: string): void {
	if (paneNotesMap.has(uniqId)) {
		paneNotesMap.delete(uniqId);
		notifyNoteListeners();
	}
}

function subscribeNotes(listener: () => void): () => void {
	noteListeners.add(listener);
	return () => { noteListeners.delete(listener); };
}

/** Хук: уведомления конкретной панели */
export function usePaneNotifications(uniqId: string): PaneNotification[] {
	return useSyncExternalStore(
		subscribeNotes,
		() => paneNotesMap.get(uniqId) ?? emptyNotes,
		() => emptyNotes,
	);
}
const emptyNotes: PaneNotification[] = [];

function getOrCreate<F extends object>(
	defaultFields: F,
	tableDefs: Record<string, TableDef>,
	endpoint: string,
	uuid: string | undefined,
	storageKey: string,
): FormStore<F> {
	if (!storeCache.has(storageKey)) {
		storeCache.set(
			storageKey,
			createFormStore(defaultFields, tableDefs, endpoint, uuid, storageKey),
		);
	}
	return storeCache.get(storageKey)! as FormStore<F>;
}

// ═══════════════════════════════════════════════════════════════════════════
// REACT ХУКИ
// ═══════════════════════════════════════════════════════════════════════════

/** Опции для useFormStore */
export interface UseFormStoreOptions<F extends object> {
	/** API endpoint (например "organizations") */
	endpoint: string;
	/** Ключ sessionStorage (например "organizations-form") */
	storageKey: string;
	/** Поля формы по умолчанию */
	defaultFields: F;
	/** Описания вложенных таблиц */
	tables?: Record<string, TableDef>;
	/** Props панели (из компонента формы) */
	paneProps: Partial<TPane>;
	/** Начальные значения формы (если не из server, а из paneProps.data). Перезаписывают defaultFields. */
	initialFields?: F;

	/** Маппинг ответа сервера → fields. Может быть async. */
	mapServerToForm: (data: any, prev?: F) => F | Promise<F>;
	/** Формирование payload для POST/PUT. Возвращает string при ошибке валидации. */
	buildPayload: (fields: F) => Record<string, unknown> | string;
	/** Метка панели после сохранения */
	buildPaneLabel: (saved: any) => string;
	/** Доп. логика после load */
	afterLoad?: () => void;
	/** Доп. логика после save (кроме commitTables — он вызывается автоматически) */
	afterSave?: (savedData: any) => Promise<void> | void;
}

/** Возвращаемый тип useFormStore */
export interface UseFormStoreReturn<F extends object> {
	/** Ссылка на store (для прямого доступа из колбэков) */
	store: FormStore<F>;

	// ── Реактивные данные (через useSyncExternalStore) ──

	/** Значения полей формы */
	fields: F;
	/** Pending-строки вложенных таблиц */
	tables: Record<string, TableState>;
	/** Мета: isLoading, isEditMode, error и т.д. */
	meta: FormStoreState<F>["meta"];

	/** Есть ли несохранённые изменения? (реактивно) */
	isDirty: boolean;

	// ── Гранулярные хуки (для оптимизации ре-рендеров) ──

	/** Подписка на одно поле. Ре-рендер только при изменении этого поля. */
	useField: <K extends keyof F>(field: K) => [F[K], (value: F[K]) => void];
	/** Подписка на pending-строки одной таблицы. */
	useTable: (tableKey: string) => {
		pending: TDataItem[];
		setPending: (rows: TDataItem[]) => void;
		onItemsChange: (items: TDataItem[] | undefined) => void;
	};

	// ── Действия ──

	/** Обновить одно поле */
	setField: <K extends keyof F>(field: K, value: F[K]) => void;
	/** Обновить несколько полей */
	setFields: (patch: Partial<F>) => void;

	/** Загрузить с сервера (GET) */
	loadFromServer: (entityUuid: string) => Promise<void>;
	/** Сохранить + закрыть (или только сохранить) */
	handleSave: () => void;
	handleSaveAndClose: () => Promise<void>;
	handleClose: () => Promise<void>;

	/** UUID текущей записи */
	uuid: string | undefined;
	/** Уникальный ID инстанса для привязки к input name */
	formUid: string;
	/** ID панели (для регистрации тулбара) */
	paneId: string | undefined;

	// ── Совместимость со старым API ──
	/** handleFieldChange(field, stringValue) — как в useModelForm */
	handleFieldChange: (field: keyof F, value: string) => void;
	/** setFormData — совместимость для usePendingSubTable */
	setFormData: (updater: F | ((prev: F) => F)) => void;
	/** formData — совместимость с существующим JSX */
	formData: F;
	isLoading: boolean;
	isEditMode: boolean;
	error: string | null;
	errorRevision: number;
	setError: (msg: string | null) => void;
	clearFormStorage: () => void;
	submit: () => Promise<boolean>;
}

/**
 * Хук формы на основе ref-store.
 *
 * Заменяет useModelForm + usePendingSubTable единым API.
 * Все данные живут в одном ref-объекте {fields, tables, meta}.
 * React-подписки гранулярные — изменение одного поля НЕ ре-рендерит другие.
 */
export function useFormStore<F extends object>(
	options: UseFormStoreOptions<F>,
): UseFormStoreReturn<F> {
	const {
		endpoint,
		storageKey,
		defaultFields,
		initialFields,
		tables: tableDefs = {},
		paneProps,
		mapServerToForm,
		buildPayload,
		buildPaneLabel,
		afterLoad,
		afterSave,
	} = options;

	const { onSave, onClose, data, uniqId } = paneProps;
	const uuid = data?.uuid as string | undefined;
	const {
		windows: {
			removePane,
			updatePaneLabel,
			requestClose,
			registerBeforeClose,
		},
		actions: { confirm },
	} = useAppContext();
	const formUid = useUID();

	// ── Создание / получение store из кэша ──
	// Для существующих записей (uuid) ключ стабилен: "formStore:<storageKey>:<uuid>"
	// Для НОВЫХ форм ключ привязан к uniqId панели: "formStore:<storageKey>:<uniqId>"
	// Это гарантирует что каждая новая форма имеет свой собственный store.
	// При восстановлении из UnsavedForms — data._formStorageKey содержит оригинальный ключ.
	const fullStorageKey = (data as any)?._formStorageKey as string
		|| `${STORAGE_PREFIX}${storageKey}:${uuid ?? uniqId ?? "new"}`;
	const effectiveDefaults = initialFields ?? defaultFields;
	const store = getOrCreate<F>(
		effectiveDefaults,
		tableDefs,
		endpoint,
		uuid,
		fullStorageKey,
	);

	// ── Стабильные ref-ы для колбэков (не пересоздаются) ──
	const mapRef = useRef(mapServerToForm);
	mapRef.current = mapServerToForm;
	const buildPayloadRef = useRef(buildPayload);
	buildPayloadRef.current = buildPayload;
	const buildLabelRef = useRef(buildPaneLabel);
	buildLabelRef.current = buildPaneLabel;
	const afterLoadRef = useRef(afterLoad);
	afterLoadRef.current = afterLoad;
	const afterSaveRef = useRef(afterSave);
	afterSaveRef.current = afterSave;
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// Refs для deferred-доступа из эффектов, создаваемых раньше определения функций
	const submitRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
	const loadFromServerRef = useRef<(entityUuid: string) => Promise<void>>(async () => {});

	// ── Полная подписка (для meta / error / loading) ──
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);

	// ── Auto-load при монтировании ──
	const loadTriggeredRef = useRef(false);
	useEffect(() => {
		if (uuid && !loadTriggeredRef.current) {
			loadTriggeredRef.current = true;
			// Если данные восстановлены из sessionStorage — загружаем серверные данные
			// только для snapshot (isDirty будет сравнивать с реальным серверным состоянием).
			// Если sessionStorage пуст — полная загрузка (заменяет fields).
			store.load(uuid, mapRef.current, afterLoadRef.current, store.hadStoredData, uniqId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [uuid, store]);

	// ── Регистрация beforeClose guard ──
	useEffect(() => {
		if (!uniqId) return;

		const unregister = registerBeforeClose(uniqId, async () => {
			if (!store.isDirty()) {
				// Чистая форма — разрешаем закрытие, но чистим ресурсы
				store.clearStorage();
				storeCache.delete(store.getStorageKey());
				onCloseRef.current?.();
				return true;
			}
			const answer = await confirm(
				"Имеются несохранённые изменения. Закрыть без сохранения?",
			);
			if (!answer) return false;
			// Очистка при подтверждённом закрытии
			store.clearStorage();
			storeCache.delete(store.getStorageKey());
			onCloseRef.current?.();
			return true;
		});

		return unregister;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [uniqId, store]);

	// ── Синхронизация dirty-состояния → индикатор на вкладке ──
	useEffect(() => {
		if (!uniqId) return;
		// Первоначальная проверка
		setPaneDirty(uniqId, store.isDirty());
		// Подписка на изменения store
		const unsub = store.subscribe(() => {
			setPaneDirty(uniqId, store.isDirty());
		});
		return () => {
			unsub();
			setPaneDirty(uniqId, false);
			clearPaneNotifications(uniqId);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [uniqId, store]);

	// ── Уведомление при восстановлении dirty-формы из sessionStorage ──
	useEffect(() => {
		if (!uniqId || !store.hadStoredData) return;
		const noteText =
			"В прошлый раз вы изменили данные в этой форме, но не сохранили их. " +
			"Текущие поля содержат ваши несохранённые правки.";
		const noteCtx = {
			paneLabel: paneProps.label,
			ref: uuid ? { endpoint, uuid } : undefined,
		};
		const noteActions: PaneNotificationAction[] = [
			{
				label: "Сохранить",
				onClick: () => submitRef.current(),
			},
			{
				label: "Обновить",
				onClick: () => {
					if (uuid) loadFromServerRef.current(uuid);
				},
			},
		];
		let fired = false;
		const fire = () => {
			if (fired) return;
			fired = true;
			addPaneNotification(uniqId, "warning", noteText, noteCtx, noteActions);
		};
		// Ждём загрузки серверных данных, после чего проверяем isDirty
		const unsub = store.subscribe(() => {
			if (store.isDirty()) { fire(); unsub(); }
		});
		// Проверим сразу (если snapshot уже ready)
		if (store.isDirty()) { fire(); unsub(); }
		return unsub;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [uniqId, store]);

	// ── Гранулярный useField ──
	const useField = useCallback(
		<K extends keyof F>(field: K): [F[K], (value: F[K]) => void] => {
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const value = useSyncExternalStore(
				store.subscribe,
				() => store.getSnapshot().fields[field],
				() => store.getSnapshot().fields[field],
			);
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const setValue = useCallback(
				(v: F[K]) => store.setField(field, v),
				// eslint-disable-next-line react-hooks/exhaustive-deps
				[field],
			);
			return [value, setValue];
		},
		[store],
	);

	// ── Гранулярный useTable ──
	const useTable = useCallback(
		(tableKey: string) => {
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const tableState = useSyncExternalStore(
				store.subscribe,
				() => store.getSnapshot().tables[tableKey],
				() => store.getSnapshot().tables[tableKey],
			);

			// eslint-disable-next-line react-hooks/rules-of-hooks
			const setPending = useCallback(
				(rows: TDataItem[]) =>
					store.setTablePending(tableKey, rows),
				// eslint-disable-next-line react-hooks/exhaustive-deps
				[tableKey],
			);

			// onItemsChange — колбэк для SubTable.onItemsChange
			// Фильтрует строки с _pendingAction и сохраняет в store
			// eslint-disable-next-line react-hooks/rules-of-hooks
			const onItemsChange = useCallback(
				(items: TDataItem[] | undefined) => {
					const all = items ?? [];
					const pending = all.filter(
						(r: any) => r._pendingAction,
					);
					store.setTablePending(tableKey, pending);
				},
				// eslint-disable-next-line react-hooks/exhaustive-deps
				[tableKey],
			);

			return {
				pending: tableState?.pending ?? [],
				setPending,
				onItemsChange,
			};
		},
		[store],
	);

	// ── loadFromServer ──
	const loadFromServer = useCallback(
		async (entityUuid: string) => {
			await store.load(
				entityUuid,
				mapRef.current,
				afterLoadRef.current,
				false,
				uniqId,
			);
		},
		[store, uniqId],
	);

	// ── Submit (fields + tables) ──
	const submit = useCallback(async (): Promise<boolean> => {
		const { success, savedData } = await store.submitFields(
			buildPayloadRef.current,
			mapRef.current,
			buildLabelRef.current,
			updatePaneLabel,
			uniqId,
		);
		if (!success) return false;

		// Коммит всех pending-таблиц
		const parentUuid =
			savedData?.uuid ??
			store.getSnapshot().meta.uuid ??
			"";
		if (Object.keys(tableDefs).length > 0 && parentUuid) {
			try {
				await store.commitAllTables(parentUuid);
			} catch (e: any) {
				store.setError(
					e?.message ||
						"Не удалось сохранить вложенные данные",
				);
				return false;
			}
		}

		// afterSave — дополнительная логика (invalidate и т.д.)
		if (afterSaveRef.current) {
			try {
				await afterSaveRef.current(savedData);
			} catch (e: any) {
				store.setError(
					e?.message ||
						"Ошибка после сохранения",
				);
				return false;
			}
		}

		onSaveRef.current?.();
		store.markClean();

		// Миграция storageKey после первого POST (new → uuid).
		// Если запись была создана (есть savedData.uuid) и текущий ключ НЕ содержит uuid —
		// мигрируем ключ, чтобы при F5 данные были привязаны к uuid записи.
		const newUuid = savedData?.uuid ?? store.getSnapshot().meta.uuid;
		if (newUuid) {
			const uuidKey = `${STORAGE_PREFIX}${storageKey}:${newUuid}`;
			if (store.getStorageKey() !== uuidKey) {
				store.migrateStorageKey(uuidKey);
			}
		}

		return true;
	}, [store, tableDefs, updatePaneLabel, uniqId, storageKey]);

	// ── Actions ──
	submitRef.current = submit;
	loadFromServerRef.current = loadFromServer;

	const handleSave = useCallback(() => {
		submit();
	}, [submit]);

	const handleSaveAndClose = useCallback(async () => {
		if (await submit()) {
			const currentKey = store.getStorageKey();
			store.clearStorage();
			storeCache.delete(currentKey);
			onCloseRef.current?.();
			if (uniqId) removePane(uniqId);
		}
	}, [submit, store, uniqId, removePane]);

	const handleClose = useCallback(async () => {
		if (uniqId) {
			// requestClose вызовет beforeClose guard, который
			// проверит isDirty и выполнит очистку при подтверждении
			await requestClose(uniqId);
		} else {
			// Нет uniqId — прямое закрытие с проверкой
			if (store.isDirty()) {
				const answer = await confirm(
					"Имеются несохранённые изменения. Закрыть без сохранения?",
				);
				if (!answer) return;
			}
			store.clearStorage();
			storeCache.delete(store.getStorageKey());
			onCloseRef.current?.();
		}
	}, [store, uniqId, requestClose, confirm]);

	// ── Совместимость со старым API ──
	const handleFieldChange = useCallback(
		(field: keyof F, value: string) => {
			store.setField(field, value as any);
		},
		[store],
	);

	const setFormData = useCallback(
		(updater: F | ((prev: F) => F)) => {
			const current = store.getSnapshot().fields;
			const next =
				typeof updater === "function"
					? (updater as (prev: F) => F)(current)
					: updater;
			store.replaceFields(next);
		},
		[store],
	);

	const clearFormStorage = useCallback(() => {
		store.clearStorage();
		storeCache.delete(store.getStorageKey());
	}, [store]);

	return {
		store,

		// Реактивные данные
		fields: snapshot.fields,
		tables: snapshot.tables,
		meta: snapshot.meta,

		// Dirty-состояние (реактивно — обновляется при каждом snapshot)
		isDirty: store.isDirty(),

		// Гранулярные хуки
		useField,
		useTable,

		// Прямые мутации
		setField: store.setField,
		setFields: store.setFields,

		// API
		loadFromServer,
		handleSave,
		handleSaveAndClose,
		handleClose,

		uuid,
		formUid,
		paneId: uniqId,

		// ── Совместимость ──
		handleFieldChange,
		setFormData,
		formData: snapshot.fields,
		isLoading: snapshot.meta.isLoading,
		isEditMode: snapshot.meta.isEditMode,
		error: snapshot.meta.error,
		errorRevision: snapshot.meta.errorRevision,
		setError: store.setError,
		clearFormStorage,
		submit,
	};
}
